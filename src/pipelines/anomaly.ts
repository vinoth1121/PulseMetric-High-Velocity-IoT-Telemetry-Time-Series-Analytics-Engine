import { Document } from 'mongodb';

export interface AnomalyPipelineOptions {
  deviceId: string;
  metric: string;
  from: Date;
  to: Date;
  stepSeconds?: number;
  fillMethod?: 'locf' | 'linear';
  mergeIntoAlerts?: boolean;
  minSamples?: number;
  zScoreThreshold?: number;
}

export function buildAnomalyPipeline(options: AnomalyPipelineOptions): Document[] {
  const {
    deviceId,
    metric,
    from,
    to,
    stepSeconds = 5,
    fillMethod = 'locf',
    mergeIntoAlerts = false,
    minSamples = 5,
    zScoreThreshold = 3.0
  } = options;

  const pipeline: Document[] = [
    // 1. Index-accelerated match on meta + ts range
    {
      $match: {
        'meta.deviceId': deviceId,
        'meta.metric': metric,
        ts: { $gte: from, $lte: to }
      }
    },

    // 2. Mark raw data prior to densification
    {
      $addFields: {
        synthetic: false
      }
    },

    // 3. Densify missing timestamp intervals
    {
      $densify: {
        field: 'ts',
        partitionByFields: ['meta.deviceId', 'meta.metric'],
        range: {
          step: Math.max(1, stepSeconds),
          unit: 'second',
          bounds: 'partition'
        }
      }
    },

    // 4. Fill gaps with locf or linear interpolation
    {
      $fill: {
        partitionByFields: ['meta.deviceId', 'meta.metric'],
        sortBy: { ts: 1 },
        output: {
          value: { method: fillMethod }
        }
      }
    },

    // 5. Densified points marked synthetic = true
    {
      $addFields: {
        synthetic: { $ifNull: ['$synthetic', true] }
      }
    },

    // 6. Rolling statistical window
    {
      $setWindowFields: {
        partitionBy: {
          deviceId: '$meta.deviceId',
          metric: '$meta.metric'
        },
        sortBy: { ts: 1 },
        output: {
          mu: {
            $avg: '$value',
            window: { range: [-15, 'current'], unit: 'minute' }
          },
          sigma: {
            $stdDevPop: '$value',
            window: { range: [-15, 'current'], unit: 'minute' }
          },
          ema: {
            $expMovingAvg: { input: '$value', alpha: 0.2 }
          },
          sampleCount: {
            $count: {},
            window: { range: [-15, 'current'], unit: 'minute' }
          }
        }
      }
    },

    // 7. Z-score calculation and 3-sigma anomaly flagging
    {
      $addFields: {
        zScore: {
          $cond: [
            { $or: [{ $eq: ['$sigma', 0] }, { $eq: ['$sigma', null] }] },
            0,
            { $abs: { $divide: [{ $subtract: ['$value', '$mu'] }, '$sigma'] } }
          ]
        },
        isAnomaly: {
          $and: [
            { $eq: ['$synthetic', false] }, // Synthetic points NEVER trigger alerts
            { $gte: ['$sampleCount', minSamples] }, // Guard against cold start noise
            {
              $gt: [
                {
                  $cond: [
                    { $or: [{ $eq: ['$sigma', 0] }, { $eq: ['$sigma', null] }] },
                    0,
                    { $abs: { $divide: [{ $subtract: ['$value', '$mu'] }, '$sigma'] } }
                  ]
                },
                zScoreThreshold
              ]
            }
          ]
        }
      }
    }
  ];

  if (mergeIntoAlerts) {
    pipeline.push(
      {
        $match: {
          isAnomaly: true
        }
      },
      {
        $project: {
          _id: 0,
          deviceId: '$meta.deviceId',
          metric: '$meta.metric',
          ts: '$ts',
          value: '$value',
          mu: '$mu',
          sigma: '$sigma',
          zScore: '$zScore',
          rule: '3-sigma',
          createdAt: '$$NOW'
        }
      },
      {
        $merge: {
          into: 'alerts',
          on: ['deviceId', 'metric', 'ts'],
          whenMatched: 'replace',
          whenNotMatched: 'insert'
        }
      }
    );
  }

  return pipeline;
}
