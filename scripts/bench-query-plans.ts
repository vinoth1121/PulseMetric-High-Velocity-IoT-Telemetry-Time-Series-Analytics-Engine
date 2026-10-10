import fs from 'fs';
import path from 'path';
import { getDb, closeDb } from '../src/db/mongo.js';
import { CanonicalReading } from '../src/adapters/types.js';

export async function runQueryPlansBenchmark() {
  console.log('[bench-query-plans] Starting query execution plan benchmark...');
  const db = await getDb();

  const noIndexName = 'bench_plan_regular_noindex';
  const indexedName = 'bench_plan_regular_indexed';
  const tsName = 'bench_plan_timeseries';

  // Cleanup prior runs
  await db.collection(noIndexName).drop().catch(() => {});
  await db.collection(indexedName).drop().catch(() => {});
  await db.collection(tsName).drop().catch(() => {});

  // Create collections
  await db.createCollection(noIndexName);
  await db.createCollection(indexedName);
  await db.createCollection(tsName, {
    timeseries: {
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'seconds'
    }
  });

  // Create compound index on indexed collection
  await db.collection(indexedName).createIndex(
    { 'meta.deviceId': 1, 'meta.metric': 1, ts: 1 },
    { name: 'idx_device_metric_ts' }
  );

  // Generate 50,000 synthetic readings across 20 devices over a 24-hour window
  console.log('[bench-query-plans] Inserting 50,000 readings into 3 test collections...');
  const now = new Date();
  const dataset: CanonicalReading[] = [];
  const startTs = now.getTime() - 24 * 3600 * 1000;

  for (let i = 0; i < 50000; i++) {
    const devNum = (i % 20) + 1;
    const deviceId = `dev-${String(devNum).padStart(3, '0')}`;
    const metric = i % 2 === 0 ? 'temperature_c' : 'battery_v';
    const ts = new Date(startTs + (i * 1700)); // distributed across 24h

    dataset.push({
      ts,
      meta: {
        deviceId,
        metric,
        facilityId: 'facility-central',
        model: 'model-alpha',
        firmware: 'v1.0'
      },
      value: Math.round((20 + (i % 10) + Math.random()) * 100) / 100
    });
  }

  // Insert in chunks
  const CHUNK = 2500;
  for (let i = 0; i < dataset.length; i += CHUNK) {
    const slice = dataset.slice(i, i + CHUNK);
    await Promise.all([
      db.collection(noIndexName).insertMany(slice, { ordered: false }),
      db.collection(indexedName).insertMany(slice, { ordered: false }),
      db.collection(tsName).insertMany(slice, { ordered: false })
    ]);
  }

  // Define 4-hour target query for dev-010, temperature_c
  const fourHoursAgo = new Date(now.getTime() - 4 * 3600 * 1000);
  const targetFilter = {
    'meta.deviceId': 'dev-010',
    'meta.metric': 'temperature_c',
    ts: { $gte: fourHoursAgo, $lte: now }
  };

  console.log('[bench-query-plans] Running explain("executionStats") for 4-hour window on dev-010...');

  // 1. Regular collection without index
  const explainNoIndex = await db.collection(noIndexName).find(targetFilter).explain('executionStats');

  // 2. Regular collection with compound index
  const explainIndexed = await db.collection(indexedName).find(targetFilter).explain('executionStats');

  // 3. Time-series collection
  const explainTimeSeries = await db.collection(tsName).find(targetFilter).explain('executionStats');

  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  fs.writeFileSync(path.join(resultsDir, 'explain-noindex.json'), JSON.stringify(explainNoIndex, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'explain-indexed.json'), JSON.stringify(explainIndexed, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'explain-timeseries.json'), JSON.stringify(explainTimeSeries, null, 2));

  // Extract helper
  const extractStats = (explainDoc: any, label: string) => {
    const stats = explainDoc.executionStats || {};
    const stages: string[] = [];

    const recurseStages = (plan: any) => {
      if (!plan) return;
      if (plan.stage) stages.push(plan.stage);
      if (plan.inputStage) recurseStages(plan.inputStage);
      if (plan.inputStages) plan.inputStages.forEach(recurseStages);
    };

    recurseStages(explainDoc.queryPlanner?.winningPlan);

    return {
      label,
      executionSuccess: stats.executionSuccess ?? true,
      nReturned: stats.nReturned || 0,
      executionTimeMillis: stats.executionTimeMillis || 0,
      totalKeysExamined: stats.totalKeysExamined || 0,
      totalDocsExamined: stats.totalDocsExamined || 0,
      stages: stages.reverse(),
      isCoveredQuery: (stats.totalDocsExamined === 0 && stats.totalKeysExamined > 0)
    };
  };

  const summary = {
    queryFilter: {
      deviceId: 'dev-010',
      metric: 'temperature_c',
      window: 'last 4 hours'
    },
    datasetSize: dataset.length,
    plans: {
      unindexed: extractStats(explainNoIndex, 'Regular Collection (No Index)'),
      compoundIndex: extractStats(explainIndexed, 'Regular Collection (Compound Index)'),
      timeSeries: extractStats(explainTimeSeries, 'MongoDB Native Time-Series Collection')
    }
  };

  fs.writeFileSync(path.join(resultsDir, 'query-plans.json'), JSON.stringify(summary, null, 2));
  console.log('[bench-query-plans] Benchmark completed:', summary);

  // Cleanup test collections
  await db.collection(noIndexName).drop().catch(() => {});
  await db.collection(indexedName).drop().catch(() => {});
  await db.collection(tsName).drop().catch(() => {});

  return summary;
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
  runQueryPlansBenchmark()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[bench-query-plans] Error:', err);
      await closeDb();
      process.exit(1);
    });
}
