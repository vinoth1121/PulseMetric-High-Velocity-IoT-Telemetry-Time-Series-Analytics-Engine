# In-Database Anomaly Pipeline Specification

## Pipeline Stages & Mechanics

The anomaly pipeline runs every 30 seconds over a trailing 30-minute window, and is also executed on-demand in the Explorer UI for arbitrary ranges.

```javascript
[
  // 1. Scope to device, metric and time window (uses time-series compound index)
  {
    $match: {
      "meta.deviceId": deviceId,
      "meta.metric": metric,
      ts: { $gte: startTime, $lte: endTime }
    }
  },

  // 2. Tag existing raw documents so they are distinguished from synthetic points
  {
    $addFields: {
      synthetic: false
    }
  },

  // 3. Densify missing time intervals
  {
    $densify: {
      field: "ts",
      partitionByFields: ["meta.deviceId", "meta.metric"],
      range: {
        step: sampleIntervalSeconds,
        unit: "second",
        bounds: "partition"
      }
    }
  },

  // 4. Fill gaps using Last-Observation-Carried-Forward (locf) or linear interpolation
  {
    $fill: {
      partitionByFields: ["meta.deviceId", "meta.metric"],
      sortBy: { ts: 1 },
      output: {
        value: { method: fillMethod } // "locf" or "linear"
      }
    }
  },

  // 5. Ensure densified docs are marked synthetic: true
  {
    $addFields: {
      synthetic: { $ifNull: ["$synthetic", true] }
    }
  },

  // 6. Compute rolling statistical windows
  {
    $setWindowFields: {
      partitionBy: {
        deviceId: "$meta.deviceId",
        metric: "$meta.metric"
      },
      sortBy: { ts: 1 },
      output: {
        mu: {
          $avg: "$value",
          window: { range: [-15, "current"], unit: "minute" }
        },
        sigma: {
          $stdDevPop: "$value",
          window: { range: [-15, "current"], unit: "minute" }
        },
        ema: {
          $expMovingAvg: { input: "$value", alpha: 0.2 } // expMovingAvg does not take range windows
        },
        sampleCount: {
          $count: {},
          window: { range: [-15, "current"], unit: "minute" }
        }
      }
    }
  },

  // 7. Calculate Z-score with division-by-zero guard and sample size validation
  {
    $addFields: {
      zScore: {
        $cond: [
          { $or: [{ $eq: ["$sigma", 0] }, { $eq: ["$sigma", null] }] },
          0,
          { $abs: { $divide: [{ $subtract: ["$value", "$mu"] }, "$sigma"] } }
        ]
      },
      isAnomaly: {
        $and: [
          { $eq: ["$synthetic", false] }, // Synthetic filled points never trigger alerts
          { $gte: ["$sampleCount", 5] },   // Guard against cold-start noise
          {
            $gt: [
              {
                $cond: [
                  { $or: [{ $eq: ["$sigma", 0] }, { $eq: ["$sigma", null] }] },
                  0,
                  { $abs: { $divide: [{ $subtract: ["$value", "$mu"] }, "$sigma"] } }
                ]
              },
              3
            ]
          }
        ]
      }
    }
  }
]
```

## Why Change Streams Are Not Used For Live Anomaly Detection

1. **Time-Series Implementation Details in MongoDB**:
   In MongoDB, time-series collections are logical views on top of clustered system bucket collections (`system.buckets.<coll>`). Direct document-level Change Streams on time-series collections either yield internal bucket documents (which contain compressed binary columns of multiple readings) or are restricted across cluster configurations.
2. **Rolling Window Requirements**:
   Anomaly detection via 3-sigma or rolling EMA requires historical context across a sliding window (e.g., 15 minutes of prior samples). Change streams deliver single inserted documents without historical window context.
3. **Atomic Deduplication via `$merge`**:
   The periodic aggregation job uses `$merge` on the unique compound key `{ deviceId: 1, metric: 1, ts: 1 }` into the `alerts` collection. If an anomaly document was already identified in a prior evaluation, it is idempotently updated rather than producing duplicate alarms.
