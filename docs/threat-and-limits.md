# Threat Model & Cloud Hosting Limits

## 1. MongoDB Atlas Free Tier (M0) Limits & Mitigation Strategy

| Metric / Feature | M0 Free Tier Boundary | PulseMetric Architecture Design & Enforcement |
| :--- | :--- | :--- |
| **Storage Quota** | 512 MB total (data + index) | Strict TTL indices on all raw collections (`readings_hot` and `readings_late` expire at 7 days; `rollup_5m` expires at 90 days). `dead_letter` is a 10MB capped collection. |
| **Ops/Sec Throttling** | Soft cap (~100 CRUD ops/sec) | The deployed cloud demo runs a low-rate simulator (~2-5 readings/sec across 10 devices). The 10,000 readings/sec stress benchmark is executed locally in Docker and documented with local hardware specifications. |
| **Max Connections** | 100 - 500 connections | App uses a single pooled `MongoClient` singleton configured with `maxPoolSize: 10`, `minPoolSize: 2`, and `maxIdleTimeMS: 30000`. |
| **Pipeline Memory** | 100 MB RAM per stage | All anomaly and rollup pipelines begin with index-covered `$match` filters constraining the time interval. Unbounded historical aggregation is rejected at the API router. |
| **Online Archive** | **Unavailable on M0** (Requires M10+) | PulseMetric stores Tier 3 (`rollup_1h`) in native regular collections without claiming Online Archive runs on Atlas M0. |
| **Time-Series `$merge`** | Cannot `$merge` into time-series | PulseMetric uses `$merge` exclusively into regular collections (`rollup_5m`, `rollup_1h`, `alerts`), never writing into time-series targets via aggregation. |

---

## 2. API Threat Model & Defensive Controls

### Authentication & Authorization
- **`POST /api/ingest`**: Requires valid `x-api-key` header matching configured secret. Unauthorized requests are rejected with HTTP 401.
- **`POST /api/demo/outage`**: Intentionally public for the interactive demo; secured with:
  - IP-based rate limiting (1 request per 10s).
  - Target device restriction: Hardcoded to only allow simulation against designated demo device IDs (`demo-reconnect-001`, etc.).
  - Maximum backlog payload cap: Strictly limited to 5,000 readings per execution.
  - Rejects arbitrary device creation or tampering.

### Injection & Input Validation
- **Strict Zod Schemas**: Every endpoint validates payloads against explicit TypeScript/Zod schemas with `.strict()`.
- **Query Parameterization**: All MongoDB queries use typed filter objects (`{ "meta.deviceId": String(id) }`). No string evaluation, `$where`, or arbitrary query operator evaluation.
- **Payload Size Limits**: Express body parser is restricted to `1mb` maximum.

### Transport Security & Browser Protection
- **Helmet**: Injects HTTP security headers including `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and restrictive Referrer policies.
- **CORS**: Configurable origin whitelist, preventing unauthorized third-party cross-origin abuse.
- **Dead-Letter Logging**: Malformed inputs or unmapped firmware versions are logged to a capped `dead_letter` collection with timestamp, IP, and payload snippet for audit and diagnostic inspection.
