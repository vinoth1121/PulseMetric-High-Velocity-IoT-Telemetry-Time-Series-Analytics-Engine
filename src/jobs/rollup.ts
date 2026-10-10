import { getCollections, closeDb } from '../db/mongo.js';
import { Document } from 'mongodb';

export interface RollupResult {
  rollup5mCount: number;
  rollup1hCount: number;
  durationMs: number;
}

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Executes hierarchical downsampling rollups.
 * Idempotent: recomputes trailing 2 windows to absorb late data.
 * Merges into rollup_5m and rollup_1h via on: "_id", whenMatched: "replace".
 */
export async function runRollupJob(recomputeLookbackMinutes: number = 20): Promise<RollupResult> {
  if (isRunning) {
    return { rollup5mCount: 0, rollup1hCount: 0, durationMs: 0 };
  }
  isRunning = true;
  const startTimer = Date.now();

  try {
    const { readingsHot, readingsLate, rollup5m, rollup1h } = await getCollections();
    const now = new Date();
    const lookback5m = new Date(now.getTime() - recomputeLookbackMinutes * 60 * 1000);

    // Aggregate from both raw hot and late collections
    // 1. Rollup 5m pipeline from raw
    const pipeline5m: Document[] = [
      {
        $match: {
          ts: { $gte: lookback5m }
        }
      },
      // Union readings_late in lookback window if any
      {
        $unionWith: {
          coll: 'readings_late',
          pipeline: [
            {
              $match: {
                ts: { $gte: lookback5m }
              }
            }
          ]
        }
      },
      {
        $addFields: {
          bucketStart: {
            $dateTrunc: { date: '$ts', unit: 'minute', binSize: 5 }
          }
        }
      },
      {
        $group: {
          _id: {
            deviceId: '$meta.deviceId',
            metric: '$meta.metric',
            start: '$bucketStart'
          },
          min: { $min: '$value' },
          max: { $max: '$value' },
          sum: { $sum: '$value' },
          count: { $sum: 1 },
          avg: { $avg: '$value' },
          p95Arr: {
            $percentile: {
              input: '$value',
              p: [0.95],
              method: 'approximate'
            }
          }
        }
      },
      {
        $project: {
          _id: 1,
          start: '$_id.start',
          min: 1,
          max: 1,
          sum: 1,
          count: 1,
          avg: { $round: ['$avg', 4] },
          p95: {
            $round: [{ $arrayElemAt: ['$p95Arr', 0] }, 4]
          },
          createdAt: '$$NOW'
        }
      },
      {
        $merge: {
          into: 'rollup_5m',
          on: '_id',
          whenMatched: 'replace',
          whenNotMatched: 'insert'
        }
      }
    ];

    await readingsHot.aggregate(pipeline5m).toArray();
    const rollup5mCount = await rollup5m.countDocuments({ start: { $gte: lookback5m } });

    // 2. Rollup 1h pipeline from rollup_5m
    // Lookback trailing 3 hours (2 full 1h windows)
    const lookback1h = new Date(now.getTime() - 180 * 60 * 1000);
    const pipeline1h: Document[] = [
      {
        $match: {
          start: { $gte: lookback1h }
        }
      },
      {
        $addFields: {
          hourStart: {
            $dateTrunc: { date: '$start', unit: 'hour', binSize: 1 }
          }
        }
      },
      {
        $group: {
          _id: {
            deviceId: '$_id.deviceId',
            metric: '$_id.metric',
            start: '$hourStart'
          },
          min: { $min: '$min' },
          max: { $max: '$max' },
          sum: { $sum: '$sum' },
          count: { $sum: '$count' },
          // Approximate p95 from 5m windows (max p95 across the constituent 5m windows)
          p95Approx: { $max: '$p95' }
        }
      },
      {
        $project: {
          _id: 1,
          start: '$_id.start',
          min: 1,
          max: 1,
          sum: 1,
          count: 1,
          avg: {
            $cond: [
              { $gt: ['$count', 0] },
              { $round: [{ $divide: ['$sum', '$count'] }, 4] },
              0
            ]
          },
          p95: '$p95Approx', // Documented as approximate
          createdAt: '$$NOW'
        }
      },
      {
        $merge: {
          into: 'rollup_1h',
          on: '_id',
          whenMatched: 'replace',
          whenNotMatched: 'insert'
        }
      }
    ];

    await rollup5m.aggregate(pipeline1h).toArray();
    const rollup1hCount = await rollup1h.countDocuments({ start: { $gte: lookback1h } });

    const durationMs = Date.now() - startTimer;
    return { rollup5mCount, rollup1hCount, durationMs };
  } catch (err: any) {
    console.error('[rollup-job] Error running downsampling rollup:', err.message);
    return { rollup5mCount: 0, rollup1hCount: 0, durationMs: Date.now() - startTimer };
  } finally {
    isRunning = false;
  }
}

export function startRollupScheduler(intervalMs: number = 300000): void {
  if (timer) return;
  console.log(`[rollup-job] Starting rollup scheduler (every ${intervalMs / 1000}s)...`);
  runRollupJob().catch(() => {});
  timer = setInterval(() => {
    runRollupJob().catch(() => {});
  }, intervalMs);
}

export function stopRollupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
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
  console.log('[rollup-cli] Executing manual rollup pass...');
  runRollupJob(60 * 24 * 7) // Full 7-day lookback for CLI run
    .then(async (res) => {
      console.log(`[rollup-cli] Completed in ${res.durationMs}ms:`, res);
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[rollup-cli] Failed:', err);
      await closeDb();
      process.exit(1);
    });
}
