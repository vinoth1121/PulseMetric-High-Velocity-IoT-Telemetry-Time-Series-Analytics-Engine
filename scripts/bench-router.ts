import fs from 'fs';
import path from 'path';
import { getDb, getCollections, closeDb } from '../src/db/mongo.js';
import { QueryRouter } from '../src/router/index.js';

export async function runRouterBenchmark() {
  console.log('[bench-router] Starting 1-year dashboard query benchmark (Raw Scan vs Smart Router Downsampling)...');
  const db = await getDb();
  const { rollup1h } = await getCollections();

  const rawCollName = 'bench_router_raw_1y';
  await db.collection(rawCollName).drop().catch(() => {});
  await db.createCollection(rawCollName);
  await db.collection(rawCollName).createIndex({ 'meta.deviceId': 1, 'meta.metric': 1, ts: 1 });

  const deviceId = 'dev-bench-router';
  const metric = 'temperature_c';
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000);

  // Generate 1-year dataset: 8,760 hours
  // In raw collection: 1 reading every 15 minutes = 35,040 documents
  // In rollup_1h: 8,760 documents
  console.log('[bench-router] Seeding 35,040 raw documents and 8,760 1-hour rollup documents for 1-year range...');
  const rawDocs: any[] = [];
  const rollupDocs: any[] = [];

  const step15m = 15 * 60 * 1000;
  for (let t = oneYearAgo.getTime(); t <= now.getTime(); t += step15m) {
    const ts = new Date(t);
    const val = Math.round((20 + Math.sin(t / 86400000) * 5 + Math.random()) * 100) / 100;
    rawDocs.push({
      ts,
      meta: {
        deviceId,
        metric,
        facilityId: 'facility-central',
        model: 'model-alpha',
        firmware: 'v1.0'
      },
      value: val
    });
  }

  for (let t = oneYearAgo.getTime(); t <= now.getTime(); t += 3600 * 1000) {
    const hourStart = new Date(t);
    const val = Math.round((20 + Math.sin(t / 86400000) * 5) * 100) / 100;
    rollupDocs.push({
      _id: { deviceId, metric, start: hourStart },
      start: hourStart,
      min: val - 1.5,
      max: val + 1.8,
      sum: val * 4,
      count: 4,
      avg: val,
      p95: val + 1.2,
      createdAt: now
    });
  }

  // Insert raw
  const CHUNK = 5000;
  for (let i = 0; i < rawDocs.length; i += CHUNK) {
    await db.collection(rawCollName).insertMany(rawDocs.slice(i, i + CHUNK), { ordered: false });
  }

  // Insert rollup_1h
  for (let i = 0; i < rollupDocs.length; i += CHUNK) {
    await rollup1h.insertMany(rollupDocs.slice(i, i + CHUNK), { ordered: false }).catch(() => {});
  }

  console.log('[bench-router] Executing 1-year query A: Full raw scan...');
  const t0Raw = Date.now();
  const rawExplain = await db.collection(rawCollName).find({
    'meta.deviceId': deviceId,
    'meta.metric': metric,
    ts: { $gte: oneYearAgo, $lte: now }
  }).explain('executionStats');
  const rawDurationMs = Date.now() - t0Raw;

  const rawDocsScanned = rawExplain.executionStats?.totalDocsExamined || rawDocs.length;
  const rawReturned = rawExplain.executionStats?.nReturned || rawDocs.length;

  console.log('[bench-router] Executing 1-year query B: Smart Query Router (routed to Tier 3 rollup_1h)...');
  const t0Router = Date.now();
  const routerResult = await QueryRouter.execute({
    deviceId,
    metric,
    from: oneYearAgo,
    to: now,
    maxPoints: 1000
  });
  const routerDurationMs = Date.now() - t0Router;

  const summary = {
    testDescription: '1-Year Historical Query Range (365 days)',
    deviceId,
    metric,
    rawScan: {
      collection: rawCollName,
      totalDocumentsInCollection: rawDocs.length,
      docsExamined: rawDocsScanned,
      pointsReturned: rawReturned,
      latencyMs: rawDurationMs,
      executionStage: rawExplain.queryPlanner?.winningPlan?.stage || 'COLLSCAN'
    },
    smartRouter: {
      resolvedTier: routerResult.tier,
      docsExamined: routerResult.docsScanned,
      pointsReturned: routerResult.points.length,
      latencyMs: routerDurationMs,
      serverReportedMs: routerResult.serverMs
    },
    comparison: {
      docsScannedReductionRatio: Math.round((rawDocsScanned / Math.max(1, routerResult.docsScanned)) * 10) / 10,
      latencySpeedupMultiplier: Math.round((rawDurationMs / Math.max(1, routerDurationMs)) * 10) / 10
    }
  };

  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'router.json'), JSON.stringify(summary, null, 2));

  console.log('[bench-router] Router benchmark complete:', summary);

  // Cleanup raw test collection
  await db.collection(rawCollName).drop().catch(() => {});

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
  runRouterBenchmark()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[bench-router] Error:', err);
      await closeDb();
      process.exit(1);
    });
}
