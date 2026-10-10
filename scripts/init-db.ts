import { getDb, closeDb } from '../src/db/mongo.js';
import fs from 'fs';
import path from 'path';

export async function initDb() {
  const db = await getDb();
  console.log(`[init-db] Initializing PulseMetric collections on database "${db.databaseName}"...`);

  const existingCollections = await db.listCollections().toArray();
  const existingNames = new Set(existingCollections.map(c => c.name));

  // 1. readings_hot (time-series, granularity "seconds", expireAfterSeconds = 7 days)
  if (!existingNames.has('readings_hot')) {
    console.log('[init-db] Creating "readings_hot" (time-series, granularity="seconds", expireAfterSeconds=7d)...');
    await db.createCollection('readings_hot', {
      timeseries: {
        timeField: 'ts',
        metaField: 'meta',
        granularity: 'seconds'
      },
      expireAfterSeconds: 7 * 86400 // 7 days
    });
  } else {
    console.log('[init-db] "readings_hot" already exists.');
  }

  // 2. readings_late (time-series, bucketMaxSpanSeconds=86400, bucketRoundingSeconds=86400, expireAfterSeconds=7d)
  if (!existingNames.has('readings_late')) {
    console.log('[init-db] Creating "readings_late" (time-series, bucketMaxSpanSeconds=86400, expireAfterSeconds=7d)...');
    await db.createCollection('readings_late', {
      timeseries: {
        timeField: 'ts',
        metaField: 'meta',
        bucketMaxSpanSeconds: 86400,
        bucketRoundingSeconds: 86400
      },
      expireAfterSeconds: 7 * 86400 // 7 days
    });
  } else {
    console.log('[init-db] "readings_late" already exists.');
  }

  // 3. rollup_5m (regular, _id {deviceId, metric, start}, TTL 90 days on start)
  if (!existingNames.has('rollup_5m')) {
    console.log('[init-db] Creating regular collection "rollup_5m"...');
    await db.createCollection('rollup_5m');
  }
  const rollup5m = db.collection('rollup_5m');
  await rollup5m.createIndex({ '_id.deviceId': 1, '_id.metric': 1, '_id.start': 1 }, { name: 'idx_rollup5m_query' });
  await rollup5m.createIndex({ 'start': 1 }, { expireAfterSeconds: 90 * 86400, name: 'idx_rollup5m_ttl' });

  // 4. rollup_1h (regular, _id {deviceId, metric, start}, retained indefinitely)
  if (!existingNames.has('rollup_1h')) {
    console.log('[init-db] Creating regular collection "rollup_1h"...');
    await db.createCollection('rollup_1h');
  }
  const rollup1h = db.collection('rollup_1h');
  await rollup1h.createIndex({ '_id.deviceId': 1, '_id.metric': 1, '_id.start': 1 }, { name: 'idx_rollup1h_query' });
  await rollup1h.createIndex({ 'start': 1 }, { name: 'idx_rollup1h_start' });

  // 5. alerts (regular, dedupe key {deviceId, metric, ts}, TTL 30 days)
  if (!existingNames.has('alerts')) {
    console.log('[init-db] Creating regular collection "alerts"...');
    await db.createCollection('alerts');
  }
  const alerts = db.collection('alerts');
  await alerts.createIndex({ deviceId: 1, metric: 1, ts: 1 }, { unique: true, name: 'idx_alerts_dedupe' });
  await alerts.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400, name: 'idx_alerts_ttl' });

  // 6. dead_letter (capped collection, 10MB)
  if (!existingNames.has('dead_letter')) {
    console.log('[init-db] Creating capped collection "dead_letter"...');
    await db.createCollection('dead_letter', {
      capped: true,
      size: 10 * 1024 * 1024,
      max: 50000
    });
  } else {
    console.log('[init-db] "dead_letter" already exists.');
  }

  // 7. device_registry (regular collection)
  if (!existingNames.has('device_registry')) {
    console.log('[init-db] Creating regular collection "device_registry"...');
    await db.createCollection('device_registry');
  }
  const devReg = db.collection('device_registry');
  await devReg.createIndex({ facilityId: 1 }, { name: 'idx_devreg_facility' });

  // Record indexes on every collection
  const collectionsToCheck = [
    'readings_hot',
    'readings_late',
    'rollup_5m',
    'rollup_1h',
    'alerts',
    'dead_letter',
    'device_registry'
  ];

  const indexReport: Record<string, any[]> = {};
  for (const collName of collectionsToCheck) {
    try {
      const coll = db.collection(collName);
      const indexes = await coll.indexes();
      indexReport[collName] = indexes;
      console.log(`[init-db] Indexes on "${collName}":`, indexes.map(i => i.name));
    } catch (err: any) {
      console.warn(`[init-db] Warning listing indexes for ${collName}:`, err.message);
    }
  }

  // Write indexes report to docs directory
  const docsDir = path.resolve(process.cwd(), 'docs');
  if (fs.existsSync(docsDir)) {
    fs.writeFileSync(path.join(docsDir, 'indexes.json'), JSON.stringify(indexReport, null, 2));
    console.log('[init-db] Wrote docs/indexes.json successfully.');
  }

  console.log('[init-db] Database initialization completed.');
  return indexReport;
}

import { fileURLToPath } from 'url';

const isDirectCli = () => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  initDb()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[init-db] Error initializing database:', err);
      await closeDb();
      process.exit(1);
    });
}
