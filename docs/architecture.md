# PulseMetric Architecture

```
                                  [IoT Fleet / Edge Gateways]
                                               │
                                               ▼
                              POST /api/ingest (Header: x-api-key)
                                               │
                                 ┌─────────────┴─────────────┐
                                 │ Rate Limiter & Zod Schema │
                                 └─────────────┬─────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │ Polymorphic Sensor Adapters │
                                │ (v1, v2, v3 -> Canonical)   │
                                └──────────────┬──────────────┘
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         │   Temporal Classifier (|event_ts - now|)  │
                         └──────────────┬─────────────┬──────────────┘
                                        │             │
                drift <= 5 min          │             │ drift > 5 min (backlog)
          ┌─────────────────────────────┘             └─────────────────────────────┐
          ▼                                                                         ▼
   [HOT INGESTION LANE]                                                    [COLD INGESTION LANE]
   Direct Unordered Batch                                                  In-Memory Micro-Quarantine
   insertMany(ordered: false)                                              Sort: (deviceId, metric, ts)
          │                                                                insertMany(ordered: false) in chunks
          ▼                                                                         │
   readings_hot (Time-Series)                                                       ▼
   • Granularity: seconds                                                  readings_late (Time-Series)
   • TTL: 7 days                                                           • Day-aligned buckets: 86400s
                                                                           • TTL: 7 days
          │                                                                         │
          └─────────────────────────────┬───────────────────────────────────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
              [Rollup Job (Every 5m)]        [Anomaly Pipeline (Every 30s)]
              Raw -> rollup_5m               $match -> $densify -> $fill ->
              5m -> rollup_1h                $setWindowFields (mu, sigma, ema) ->
              Idempotent $merge              $addFields (Z-score) -> $merge alerts
                         │                             │
                         │                             ▼
                         │                      SSE Stream (/api/alerts/stream)
                         ▼                             │
               [Smart Query Router]                    ▼
               GET /api/series               [Thermal Strip-Chart UI]
               • T1: Raw (< 4h)              • Live strip charts (uPlot)
               • T2: 5m (< 7d)               • Anomaly stamps & dashed fills
               • T3: 1h (> 7d)               • Tier & docsScanned badge
               • Seam-stitched facets        • Outage simulation lab
```

## Core Architectural Pillars

### 1. Dual-Lane Temporal Ingestion
Standard time-series ingest architectures suffer severe bucket churn when out-of-order readings arrive intermingled with real-time streams. MongoDB's time-series engine opens distinct buckets per partition tag. When retroactive readings arrive, the storage engine frequently re-opens or fractures existing buckets, degrading compression ratios and increasing memory thrash.

PulseMetric solves this by classifying incoming telemetry into two segregated physical lanes:
1. **HOT Lane (`readings_hot`)**: For real-time readings within 5 minutes of system clock. Telemetry streams directly in unordered batches for maximum write throughput.
2. **COLD Lane (`readings_late`)**: For delayed or reconnecting backlogs. Telemetry is quarantined in memory, sorted sequentially by partition key and timestamp, and written to day-aligned buckets (`bucketMaxSpanSeconds = 86400`). This ensures backlog data compresses into a minimal number of tightly packed buckets.

### 2. In-Database Anomaly Pipeline
Rather than pulling megabytes of raw sensor data across the wire to Node.js or Python workers to compute rolling statistical windows:
- MongoDB 7.0+ aggregation operators (`$densify`, `$fill`, `$setWindowFields`) compute rolling means ($\mu$), standard deviations ($\sigma$), and exponential moving averages ($EMA$) entirely inside the database engine.
- Synthetic points generated by gap-filling are tagged with `synthetic: true` to prevent false alarm triggers.
- Anomalies are merged atomically into an `alerts` collection and streamed in real-time to connected frontends via Server-Sent Events (SSE).

### 3. 3-Tier Hierarchical Downsampling & Smart Router
Queries asking for 1 month of raw telemetry across a fleet would otherwise scan millions of documents, exhausting I/O and browser RAM.
- **Tier 1 (Raw)**: `readings_hot` and `readings_late` (7-day retention).
- **Tier 2 (5-minute Rollups)**: `rollup_5m` with exact min, max, sum, count, avg, and p95 (90-day retention).
- **Tier 3 (1-hour Rollups)**: `rollup_1h` re-aggregated from 5m rollups with exact min, max, sum, count, avg, and approximate p95 (indefinite retention).
- **Smart Query Router**: Evaluates the requested time window and `maxPoints` budget to route to the optimal tier, seamlessly stitching boundaries at the seam without data duplication.
