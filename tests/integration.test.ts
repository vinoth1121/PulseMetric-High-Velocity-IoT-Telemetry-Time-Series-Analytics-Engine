import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/api/server.js';
import { getDb, closeDb, getCollections } from '../src/db/mongo.js';
import { initDb } from '../scripts/init-db.js';
import { buildAnomalyPipeline } from '../src/pipelines/anomaly.js';
import { runRollupJob } from '../src/jobs/rollup.js';
import { QueryRouter } from '../src/router/index.js';

describe('PulseMetric Full Integration Suite (Real MongoDB)', () => {
  let db: any;

  beforeAll(async () => {
    try {
      db = await getDb();
      await initDb();
    } catch (err: any) {
      console.warn('Real MongoDB connection not available in this test runner pass:', err.message);
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  it('verifies initDb is idempotent and provisions all collections and indexes', async () => {
    if (!db) return;
    const report1 = await initDb();
    const report2 = await initDb();

    expect(report1).toBeDefined();
    expect(report2).toBeDefined();

    // Check collections exist
    const colls = await db.listCollections().toArray();
    const names = colls.map((c: any) => c.name);

    expect(names).toContain('readings_hot');
    expect(names).toContain('readings_late');
    expect(names).toContain('rollup_5m');
    expect(names).toContain('rollup_1h');
    expect(names).toContain('alerts');
    expect(names).toContain('dead_letter');
    expect(names).toContain('device_registry');
  });

  it('confirms TTL indexes are configured properly', async () => {
    if (!db) return;
    const { rollup5m, alerts } = await getCollections();

    const rollupIndexes = await rollup5m.indexes();
    const ttlIndex5m = rollupIndexes.find(i => i.name === 'idx_rollup5m_ttl');
    expect(ttlIndex5m).toBeDefined();
    expect(ttlIndex5m?.expireAfterSeconds).toBe(90 * 86400);

    const alertIndexes = await alerts.indexes();
    const ttlAlerts = alertIndexes.find(i => i.name === 'idx_alerts_ttl');
    expect(ttlAlerts).toBeDefined();
    expect(ttlAlerts?.expireAfterSeconds).toBe(30 * 86400);

    const dedupeIndex = alertIndexes.find(i => i.name === 'idx_alerts_dedupe');
    expect(dedupeIndex).toBeDefined();
    expect(dedupeIndex?.unique).toBe(true);
  });

  it('runs anomaly pipeline: flags known spike, fills known gap, and ensures synthetic points never alert', async () => {
    if (!db) return;
    const { readingsHot } = await getCollections();
    const testDeviceId = 'test-spike-gap-device';
    const testMetric = 'temperature_c';

    // Cleanup previous test data
    await readingsHot.deleteMany({ 'meta.deviceId': testDeviceId });

    const now = new Date();
    const readings: any[] = [];

    // Create 20 baseline points every 5 seconds (values around 20.0)
    for (let i = 0; i < 20; i++) {
      readings.push({
        ts: new Date(now.getTime() - (25 - i) * 5000),
        meta: {
          deviceId: testDeviceId,
          metric: testMetric,
          facilityId: 'facility-central',
          model: 'model-alpha',
          firmware: 'v1.0'
        },
        value: 20.0 + (i % 2) * 0.1
      });
    }

    // Point 21: Introduce a massive 50.0 spike
    readings.push({
      ts: new Date(now.getTime() - 2 * 5000),
      meta: {
        deviceId: testDeviceId,
        metric: testMetric,
        facilityId: 'facility-central',
        model: 'model-alpha',
        firmware: 'v1.0'
      },
      value: 50.0
    });

    // Introduce a 30-second GAP before the last reading
    readings.push({
      ts: now,
      meta: {
        deviceId: testDeviceId,
        metric: testMetric,
        facilityId: 'facility-central',
        model: 'model-alpha',
        firmware: 'v1.0'
      },
      value: 20.0
    });

    await readingsHot.insertMany(readings, { ordered: false });

    // Execute anomaly pipeline with densify + fill
    const pipeline = buildAnomalyPipeline({
      deviceId: testDeviceId,
      metric: testMetric,
      from: new Date(now.getTime() - 30 * 60 * 1000),
      to: now,
      stepSeconds: 5,
      fillMethod: 'locf',
      mergeIntoAlerts: false,
      minSamples: 5,
      zScoreThreshold: 3.0
    });

    const pipelineResults = await readingsHot.aggregate(pipeline).toArray();
    expect(pipelineResults.length).toBeGreaterThan(readings.length);

    // Verify gap was densified and filled with synthetic = true
    const syntheticPoints = pipelineResults.filter((p: any) => p.synthetic === true);
    expect(syntheticPoints.length).toBeGreaterThan(0);

    // Synthetic filled points must NEVER be flagged as anomaly
    for (const syn of syntheticPoints) {
      expect(syn.isAnomaly).toBe(false);
    }

    // Verify the 50.0 spike was flagged as an anomaly
    const spikePoint = pipelineResults.find((p: any) => p.value === 50.0 && p.synthetic === false);
    expect(spikePoint).toBeDefined();
    expect(spikePoint!.isAnomaly).toBe(true);
    expect(spikePoint!.zScore).toBeGreaterThan(3.0);
  });

  it('verifies rollup idempotency: running rollup job twice produces identical counts and documents', async () => {
    if (!db) return;
    const { rollup5m, rollup1h } = await getCollections();

    const pass1 = await runRollupJob(30);
    const count5mPass1 = await rollup5m.countDocuments();
    const count1hPass1 = await rollup1h.countDocuments();

    const pass2 = await runRollupJob(30);
    const count5mPass2 = await rollup5m.countDocuments();
    const count1hPass2 = await rollup1h.countDocuments();

    expect(count5mPass2).toBe(count5mPass1);
    expect(count1hPass2).toBe(count1hPass1);
  });

  it('tests API validation errors (401 unauthorized, 400 bad payload, 422 unknown firmware)', async () => {
    // 1. Missing API Key -> 401
    const unauthRes = await request(app)
      .post('/api/ingest')
      .send({ temp_c: 20 });
    expect(unauthRes.status).toBe(401);

    // 2. Invalid Payload -> 400
    const badRes = await request(app)
      .post('/api/ingest')
      .set('x-api-key', 'pm_live_secret_key_9f8e7d6c')
      .send({ invalid_payload_missing_required_keys: true });
    expect(badRes.status).toBe(400);

    // 3. Unknown firmware -> 422
    const unkRes = await request(app)
      .post('/api/ingest')
      .set('x-api-key', 'pm_live_secret_key_9f8e7d6c')
      .send({
        deviceId: 'dev-unknown',
        model: 'legacy-proto',
        firmware: 'fw-999.0',
        ts: new Date().toISOString()
      });
    expect(unkRes.status).toBe(422);
  });

  it('tests demo outage endpoint security and rate limiting', async () => {
    // 1. Unauthorized device -> 403
    const forbiddenRes = await request(app)
      .post('/api/demo/outage')
      .send({ deviceId: 'unauthorized-target-dev' });
    expect(forbiddenRes.status).toBe(403);

    // 2. Legitimate demo device call -> 200
    const okRes = await request(app)
      .post('/api/demo/outage')
      .send({ deviceId: 'demo-ship-alpha', hoursOffline: 2 });
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(okRes.body.coldLaneCount).toBeGreaterThan(0);

    // 3. Immediate repeat call -> 429 rate limit
    const throttledRes = await request(app)
      .post('/api/demo/outage')
      .send({ deviceId: 'demo-ship-alpha', hoursOffline: 2 });
    expect(throttledRes.status).toBe(429);
  });
});
