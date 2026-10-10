# PulseMetric Data Model & Storage Specification

## 1. Overview & Polymorphic Sensor Adapter

PulseMetric ingests high-velocity IoT telemetry from heterogeneous hardware revisions and protocols. Rather than forcing heterogeneous devices to conform at the edge or storing raw untyped JSON blobs, PulseMetric implements an in-flight **Polymorphic Sensor Adapter** layer backed by an optimized scalar time-series schema.

### Canonical Schema

Every time-series document in `readings_hot` and `readings_late` conforms to:

```typescript
interface CanonicalReading {
  ts: Date; // timeField
  meta: {
    deviceId: string;
    metric: string;
    facilityId: string;
    model: string;
    firmware: string;
  };
  value: number; // IEEE 754 double
  synthetic?: boolean; // Set during $densify / $fill for anomaly analysis
}
```

### Tradeoff Analysis: Scalar `(ts, metric, value)` vs Array-of-`{k, v}` Attribute Pattern

A traditional MongoDB attribute pattern often bundles multiple metrics into an array:
```json
{
  "ts": "2026-10-10T00:00:00Z",
  "deviceId": "dev-001",
  "metrics": [
    {"k": "temperature_c", "v": 21.4},
    {"k": "humidity_pct", "v": 55.2},
    {"k": "battery_v", "v": 3.12}
  ]
}
```

#### Why PulseMetric Chose One Document Per `(timestamp, metric)`:
1. **Columnar Compression in `system.buckets`**:
   MongoDB's underlying storage engine for time-series collections decomposes incoming documents into internal compressed column buckets (`system.buckets`). Scalar numeric values (`value: double`) are compressed using delta-of-delta and run-length encoding. Arrays of sub-documents disrupt dense columnar encoding and prevent direct SIMD-like column scanning.
2. **Independent Sampling & Asynchronous Frequencies**:
   Sensors on the same board often report at differing intervals (e.g., temperature every 1s, vibration every 100ms, battery voltage every 60s). Forcing a combined document requires null-padding or artificial synchronization.
3. **Targeted Granular Downsampling & TTL**:
   High-frequency metrics like acoustic vibration or motor current can be expired or rolled up independently of low-frequency metrics.
4. **Tradeoff Acknowledgment**:
   Storing one document per metric increases ingest document count by $M\times$ (where $M$ is the number of metrics per hardware reading). However, because the metadata sub-document (`meta`) is deduplicated per bucket in `system.buckets.meta`, disk storage overhead is negligible, and compression efficiency increases.

---

## 2. Collections Specification

### `readings_hot`
- **Collection Type**: MongoDB Time-Series
- **Time Field**: `ts`
- **Meta Field**: `meta`
- **Granularity**: `"seconds"`
- **Bucket Options**: Default (derived from granularity)
- **TTL (`expireAfterSeconds`)**: `604800` (7 days)
- **Purpose**: Low-latency ingestion lane for live telemetry ($\le 5\text{ minutes}$ drift from real-time).

### `readings_late`
- **Collection Type**: MongoDB Time-Series
- **Time Field**: `ts`
- **Meta Field**: `meta`
- **Bucket Span**: `bucketMaxSpanSeconds = 86400`, `bucketRoundingSeconds = 86400`
- **TTL (`expireAfterSeconds`)**: `604800` (7 days)
- **Constraint**: `granularity` cannot be combined with explicit bucket span seconds; span and rounding must be identical.
- **Purpose**: Quarantine and batch-sorted ingestion lane for out-of-order backlog telemetry (up to 7 days old). Prevents frequent opening of retroactive micro-buckets in the hot collection.

### `rollup_5m`
- **Collection Type**: Regular collection
- **`_id`**: `{ deviceId: string, metric: string, start: Date }`
- **Fields**: `min` (double), `max` (double), `sum` (double), `count` (int), `avg` (double), `p95` (double), `createdAt` (Date)
- **Indexes**:
  - `_id_`: Unique primary key index
  - `idx_rollup5m_start`: `{ "start": 1 }`
  - `idx_rollup5m_query`: `{ "_id.deviceId": 1, "_id.metric": 1, "_id.start": 1 }`
  - `idx_rollup5m_ttl`: TTL index on `start` with `expireAfterSeconds = 7776000` (90 days)

### `rollup_1h`
- **Collection Type**: Regular collection
- **`_id`**: `{ deviceId: string, metric: string, start: Date }`
- **Fields**: `min` (double), `max` (double), `sum` (double), `count` (int), `avg` (double), `p95` (double, approximate), `createdAt` (Date)
- **Indexes**:
  - `_id_`: Unique primary key index
  - `idx_rollup1h_start`: `{ "start": 1 }`
  - `idx_rollup1h_query`: `{ "_id.deviceId": 1, "_id.metric": 1, "_id.start": 1 }`
  - No TTL (retained indefinitely for multi-year trend analytics)

### `alerts`
- **Collection Type**: Regular collection
- **`_id`**: Compound or generated ObjectId
- **Fields**: `deviceId`, `metric`, `ts`, `value`, `mu`, `sigma`, `zScore`, `rule`, `createdAt`
- **Indexes**:
  - `idx_alerts_dedupe`: Unique compound index on `{ deviceId: 1, metric: 1, ts: 1 }`
  - `idx_alerts_ttl`: TTL index on `createdAt` with `expireAfterSeconds = 2592000` (30 days)

### `dead_letter`
- **Collection Type**: Capped collection
- **Size**: `10485760` bytes (10 MB), `max = 50000` documents
- **Purpose**: Stores malformed or unregistered firmware payloads rejected with HTTP 422 for auditability without unbounded storage growth.

### `device_registry`
- **Collection Type**: Regular collection
- **`_id`**: `deviceId` (string)
- **Fields**: `facilityId`, `model`, `firmware`, `status`, `lastSeen`, `batteryPct`, `metadata`
- **Indexes**:
  - `_id_`: Unique primary key
  - `idx_device_facility`: `{ facilityId: 1 }`

---

## 3. Automatic Indexes in MongoDB Time-Series

When a time-series collection is created in MongoDB 7.0+, MongoDB automatically provisions a compound index on the internal bucket collection (`system.buckets.<collection>`):
1. `{ "meta": 1, "control.min.ts": 1, "control.max.ts": 1 }`
2. `{ "control.min.ts": 1, "control.max.ts": 1 }`

These allow queries filtering on `meta.deviceId`, `meta.metric`, and `ts` ranges to perform index-bounded scans directly over bucket headers without uncompressing non-matching buckets.
