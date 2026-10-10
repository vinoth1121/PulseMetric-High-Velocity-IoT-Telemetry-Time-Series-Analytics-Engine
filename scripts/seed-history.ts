import { getCollections, closeDb } from '../src/db/mongo.js';
import { generateDeviceFleet, generateDeviceReading, createRng } from './simulate.js';
import { defaultRegistry } from '../src/adapters/registry.js';
import { CanonicalReading } from '../src/adapters/types.js';
import { runRollupJob } from '../src/jobs/rollup.js';

export async function seedHistory() {
  console.log('[seed-history] Starting historical telemetry backfill...');
  const { readingsHot, rollup5m, rollup1h, alerts, deviceRegistry } = await getCollections();

  const fleet = generateDeviceFleet(6);
  const rng = createRng(999);
  const now = new Date();

  // Register devices
  for (const dev of fleet) {
    await deviceRegistry.updateOne(
      { _id: dev.deviceId as any },
      {
        $set: {
          facilityId: dev.facilityId,
          model: dev.model,
          firmware: dev.firmware,
          status: 'online',
          lastSeen: now,
          batteryPct: Math.round(85 + rng() * 12)
        }
      },
      { upsert: true }
    );
  }

  // 1. Backfill past 48 hours of raw telemetry at 30-second steps
  console.log('[seed-history] Generating 48h of raw readings for 6 devices...');
  const rawBatch: CanonicalReading[] = [];
  const start48h = new Date(now.getTime() - 48 * 3600 * 1000);
  const stepMs = 30 * 1000;

  for (let t = start48h.getTime(); t <= now.getTime(); t += stepMs) {
    const curDate = new Date(t);
    for (const dev of fleet) {
      const raw = generateDeviceReading(dev, curDate, rng);
      try {
        const canonical = defaultRegistry.normalize(raw);
        rawBatch.push(...canonical);
      } catch {}
    }

    if (rawBatch.length >= 2000) {
      await readingsHot.insertMany(rawBatch, { ordered: false }).catch(() => {});
      rawBatch.length = 0;
    }
  }

  if (rawBatch.length > 0) {
    await readingsHot.insertMany(rawBatch, { ordered: false }).catch(() => {});
  }

  console.log('[seed-history] Raw 48h data inserted. Running hierarchical downsampling rollup...');
  // Run rollup pass to populate rollup_5m and rollup_1h
  await runRollupJob(48 * 60);

  // 2. Synthetically seed rollup_5m and rollup_1h for days 3 through 30 (Tier 2 & Tier 3)
  console.log('[seed-history] Seeding long-term rollups for days 3 through 30...');
  const start30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const rollups5mBatch: any[] = [];
  const rollups1hBatch: any[] = [];

  const metrics = ['temperature_c', 'battery_v', 'humidity_pct'];

  for (let t = start30d.getTime(); t < start48h.getTime(); t += 3600 * 1000) {
    const hourDate = new Date(t);
    for (const dev of fleet.slice(0, 3)) {
      for (const metric of metrics) {
        const baseVal = metric === 'temperature_c' ? 22 : metric === 'battery_v' ? 3.15 : 55;
        const val = Math.round((baseVal + Math.sin(t / 86400000) * 3 + (rng() - 0.5)) * 100) / 100;

        rollups1hBatch.push({
          _id: { deviceId: dev.deviceId, metric, start: hourDate },
          start: hourDate,
          min: val - 1.2,
          max: val + 1.5,
          sum: val * 12,
          count: 12,
          avg: val,
          p95: val + 1.1,
          createdAt: now
        });
      }
    }
  }

  if (rollups1hBatch.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < rollups1hBatch.length; i += CHUNK) {
      await rollup1h.insertMany(rollups1hBatch.slice(i, i + CHUNK), { ordered: false }).catch(() => {});
    }
  }

  // 3. Inject known sample alerts
  console.log('[seed-history] Seeding historical alerts...');
  const sampleAlerts = [
    {
      deviceId: 'pm-device-001',
      metric: 'temperature_c',
      ts: new Date(now.getTime() - 15 * 60 * 1000),
      value: 38.4,
      mu: 22.1,
      sigma: 1.4,
      zScore: 11.64,
      rule: '3-sigma',
      createdAt: new Date(now.getTime() - 15 * 60 * 1000)
    },
    {
      deviceId: 'pm-device-002',
      metric: 'temperature_c',
      ts: new Date(now.getTime() - 42 * 60 * 1000),
      value: 9.2,
      mu: 21.8,
      sigma: 1.2,
      zScore: 10.5,
      rule: '3-sigma',
      createdAt: new Date(now.getTime() - 42 * 60 * 1000)
    },
    {
      deviceId: 'pm-device-003',
      metric: 'pressure_hpa',
      ts: new Date(now.getTime() - 95 * 60 * 1000),
      value: 960.2,
      mu: 1013.25,
      sigma: 3.5,
      zScore: 15.15,
      rule: '3-sigma',
      createdAt: new Date(now.getTime() - 95 * 60 * 1000)
    }
  ];

  for (const a of sampleAlerts) {
    await alerts.updateOne(
      { deviceId: a.deviceId, metric: a.metric, ts: a.ts },
      { $set: a },
      { upsert: true }
    );
  }

  console.log('[seed-history] Historical backfill complete.');
}

import { fileURLToPath } from 'url';
import path from 'path';

const isDirectCli = () => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  seedHistory()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[seed-history] Error backfilling:', err);
      await closeDb();
      process.exit(1);
    });
}
