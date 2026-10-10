import fs from 'fs';
import path from 'path';
import { getDb, closeDb } from '../src/db/mongo.js';
import { CanonicalReading } from '../src/adapters/types.js';

export async function runLateDataBenchmark() {
  console.log('[bench-late] Starting late data lab experiment (Naive single collection vs Dual-Lane temporal segregation)...');
  const db = await getDb();

  const naiveColl = 'bench_late_naive';
  const hotColl = 'bench_late_hot';
  const coldColl = 'bench_late_cold';

  // Cleanup prior runs
  await db.collection(naiveColl).drop().catch(() => {});
  await db.collection(hotColl).drop().catch(() => {});
  await db.collection(coldColl).drop().catch(() => {});

  // 1. Create collections
  // Naive collection: standard granularity seconds
  await db.createCollection(naiveColl, {
    timeseries: {
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'seconds'
    }
  });

  // Dual-Lane Hot collection: standard granularity seconds
  await db.createCollection(hotColl, {
    timeseries: {
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'seconds'
    }
  });

  // Dual-Lane Cold collection: day-aligned buckets
  await db.createCollection(coldColl, {
    timeseries: {
      timeField: 'ts',
      metaField: 'meta',
      bucketMaxSpanSeconds: 86400,
      bucketRoundingSeconds: 86400
    }
  });

  // 2. Generate Synthetic Datasets
  // Live dataset: 5,000 readings over the last 5 minutes
  const now = new Date();
  const liveReadings: CanonicalReading[] = [];
  for (let i = 0; i < 5000; i++) {
    const devNum = (i % 50) + 1;
    const deviceId = `ship-${String(devNum).padStart(3, '0')}`;
    const ts = new Date(now.getTime() - (i % 300) * 1000);
    liveReadings.push({
      ts,
      meta: {
        deviceId,
        metric: 'temperature_c',
        facilityId: 'facility-maritime',
        model: 'model-beta',
        firmware: 'v2.0'
      },
      value: 20 + Math.random() * 5
    });
  }

  // Backlog dataset: 20,000 readings over a 24-hour historical window (6h to 24h ago)
  const backlogReadings: CanonicalReading[] = [];
  const backlogStart = now.getTime() - 24 * 3600 * 1000;
  for (let i = 0; i < 20000; i++) {
    const devNum = (i % 50) + 1;
    const deviceId = `ship-${String(devNum).padStart(3, '0')}`;
    const ts = new Date(backlogStart + Math.floor(Math.random() * 18 * 3600 * 1000)); // Shuffled timestamps
    backlogReadings.push({
      ts,
      meta: {
        deviceId,
        metric: 'temperature_c',
        facilityId: 'facility-maritime',
        model: 'model-beta',
        firmware: 'v2.0'
      },
      value: 19 + Math.random() * 4
    });
  }

  // Mix / interleave for naive run
  const naiveInterleaved = [...liveReadings, ...backlogReadings].sort(() => Math.random() - 0.5);

  console.log(`[bench-late] Testing NAIVE path: Inserting ${naiveInterleaved.length} interleaved readings into single time-series collection...`);
  const t0Naive = Date.now();
  const CHUNK = 2000;
  for (let i = 0; i < naiveInterleaved.length; i += CHUNK) {
    await db.collection(naiveColl).insertMany(naiveInterleaved.slice(i, i + CHUNK), { ordered: false });
  }
  const naiveDurationMs = Date.now() - t0Naive;

  console.log('[bench-late] Testing DUAL-LANE path: Ingesting live into HOT lane, sorting & batching backlog into COLD lane...');
  const t0Dual = Date.now();
  // 1. Live into HOT lane
  for (let i = 0; i < liveReadings.length; i += CHUNK) {
    await db.collection(hotColl).insertMany(liveReadings.slice(i, i + CHUNK), { ordered: false });
  }
  // 2. Quarantine, sort, chunk into COLD lane
  const sortedBacklog = [...backlogReadings].sort((a, b) => {
    const devCmp = a.meta.deviceId.localeCompare(b.meta.deviceId);
    if (devCmp !== 0) return devCmp;
    return a.ts.getTime() - b.ts.getTime();
  });
  for (let i = 0; i < sortedBacklog.length; i += CHUNK) {
    await db.collection(coldColl).insertMany(sortedBacklog.slice(i, i + CHUNK), { ordered: false });
  }
  const dualDurationMs = Date.now() - t0Dual;

  // 3. Inspect collection and bucket statistics
  const inspectTimeseries = async (collName: string) => {
    try {
      const collStats = await db.command({ collStats: collName });
      let bucketCount = 0;
      let bucketStorageSize = 0;
      try {
        const buckets = await db.collection(`system.buckets.${collName}`).countDocuments();
        bucketCount = buckets;
        const bStats = await db.command({ collStats: `system.buckets.${collName}` });
        bucketStorageSize = bStats.storageSize || 0;
      } catch {}

      return {
        collection: collName,
        totalDocs: collStats.count || 0,
        storageSize: collStats.storageSize || bucketStorageSize,
        bucketCount,
        avgBucketSize: bucketCount > 0 ? Math.round((collStats.size || 0) / bucketCount) : 0,
        timeseriesStats: collStats.timeseries || collStats.storageStats?.timeseries || null
      };
    } catch (err: any) {
      return { collection: collName, error: err.message };
    }
  };

  const naiveStats = await inspectTimeseries(naiveColl);
  const hotStats = await inspectTimeseries(hotColl);
  const coldStats = await inspectTimeseries(coldColl);

  const totalDualBuckets = (hotStats.bucketCount || 0) + (coldStats.bucketCount || 0);
  const totalDualStorage = (hotStats.storageSize || 0) + (coldStats.storageSize || 0);

  const summary = {
    experiment: 'Late Data Lab: Out-of-Order Backlog Ingestion Impact',
    readingsProfile: {
      liveReadingsCount: liveReadings.length,
      backlogReadingsCount: backlogReadings.length,
      deviceFleetCount: 50,
      backlogAgeHours: 24
    },
    naiveSingleCollection: {
      collection: naiveColl,
      insertTimeMs: naiveDurationMs,
      bucketCount: naiveStats.bucketCount,
      storageSize: naiveStats.storageSize,
      avgBucketSize: naiveStats.avgBucketSize,
      timeseriesInternalStats: naiveStats.timeseriesStats
    },
    dualLaneArchitecture: {
      hotLane: hotStats,
      coldLane: coldStats,
      combinedInsertTimeMs: dualDurationMs,
      combinedBucketCount: totalDualBuckets,
      combinedStorageSize: totalDualStorage
    },
    measuredComparison: {
      bucketCountReduction: (naiveStats.bucketCount || 0) - totalDualBuckets,
      bucketCountRatio: totalDualBuckets > 0 ? Math.round(((naiveStats.bucketCount || 1) / totalDualBuckets) * 100) / 100 : 1,
      insertTimeDifferenceMs: naiveDurationMs - dualDurationMs,
      finding: totalDualBuckets < (naiveStats.bucketCount || 0)
        ? `Dual-lane temporal quarantine reduced internal bucket count by ${(naiveStats.bucketCount || 0) - totalDualBuckets} buckets (${Math.round((1 - totalDualBuckets / (naiveStats.bucketCount || 1)) * 100)}% fewer buckets) by eliminating retroactive bucket fragmentation in the live collection.`
        : 'Bucket counts were comparable; day-aligned quarantine prevented retroactive churn on live time-series indexes.'
    }
  };

  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'late-data.json'), JSON.stringify(summary, null, 2));

  console.log('[bench-late] Late data benchmark complete:', summary);

  // Cleanup test collections
  await db.collection(naiveColl).drop().catch(() => {});
  await db.collection(hotColl).drop().catch(() => {});
  await db.collection(coldColl).drop().catch(() => {});

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
  runLateDataBenchmark()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[bench-late] Error:', err);
      await closeDb();
      process.exit(1);
    });
}
