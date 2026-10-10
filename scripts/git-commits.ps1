$ErrorActionPreference = "Stop"

function Commit-Step($msg, $files) {
    Write-Host "Staging: $files"
    foreach ($f in $files) {
        git add $f
    }
    git commit -m $msg
    Write-Host "Committed: $msg"
}

# 1. chore: project initialization, license and docker environment
Commit-Step "chore: project initialization, license and docker environment" @(
    ".gitignore",
    ".env.example",
    "LICENSE",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "Dockerfile",
    "docker-compose.yml"
)

# 2. docs: specify architecture, polymorphic data model and pipeline design
Commit-Step "docs: specify architecture, polymorphic data model and pipeline design" @(
    "docs/architecture.md",
    "docs/data-model.md",
    "docs/pipelines.md",
    "docs/threat-and-limits.md"
)

# 3. feat(adapters): define canonical reading schema and sensor adapter types
Commit-Step "feat(adapters): define canonical reading schema and sensor adapter types" @(
    "src/adapters/types.ts"
)

# 4. feat(adapters): implement v1 adapter for legacy temperature sensors
Commit-Step "feat(adapters): implement v1 adapter for legacy temperature sensors" @(
    "src/adapters/v1.ts"
)

# 5. feat(adapters): implement v2 adapter with kelvin and battery voltage conversion
Commit-Step "feat(adapters): implement v2 adapter with kelvin and battery voltage conversion" @(
    "src/adapters/v2.ts"
)

# 6. feat(adapters): implement v3 adapter with humidity and multi-unit barometric pressure
Commit-Step "feat(adapters): implement v3 adapter with humidity and multi-unit barometric pressure" @(
    "src/adapters/v3.ts"
)

# 7. feat(adapters): implement polymorphic sensor adapter registry and dead-letter logging
Commit-Step "feat(adapters): implement polymorphic sensor adapter registry and dead-letter logging" @(
    "src/adapters/registry.ts",
    "src/adapters/index.ts"
)

# 8. feat(db): implement mongo client connection manager and collection accessors
Commit-Step "feat(db): implement mongo client connection manager and collection accessors" @(
    "src/db/mongo.ts"
)

# 9. feat(db): create idempotent database initializer for time-series and rollup collections
Commit-Step "feat(db): create idempotent database initializer for time-series and rollup collections" @(
    "scripts/init-db.ts",
    "docs/indexes.json"
)

# 10. feat(classifier): implement dual-lane temporal classifier and ingest route
Commit-Step "feat(classifier): implement dual-lane temporal classifier and ingest route" @(
    "src/api/routes/ingest.ts"
)

# 11. feat(pipelines): implement in-database anomaly detection with $densify, $fill and $setWindowFields
Commit-Step "feat(pipelines): implement in-database anomaly detection with $densify, $fill and $setWindowFields" @(
    "src/pipelines/anomaly.ts"
)

# 12. feat(jobs): implement background anomaly detection runner with SSE alert broadcasting
Commit-Step "feat(jobs): implement background anomaly detection runner with SSE alert broadcasting" @(
    "src/jobs/anomaly-runner.ts",
    "src/api/routes/alerts.ts"
)

# 13. feat(rollups): implement 3-tier hierarchical downsampling rollup engine
Commit-Step "feat(rollups): implement 3-tier hierarchical downsampling rollup engine" @(
    "src/jobs/rollup.ts"
)

# 14. feat(router): implement smart query router with seam stitching and facet acceleration
Commit-Step "feat(router): implement smart query router with seam stitching and facet acceleration" @(
    "src/router/index.ts"
)

# 15. feat(api): complete core REST endpoints, device registry, lane stats, and health check
Commit-Step "feat(api): complete core REST endpoints, device registry, lane stats, and health check" @(
    "src/api/server.ts",
    "src/api/routes/devices.ts",
    "src/api/routes/series.ts",
    "src/api/routes/lanes.ts",
    "src/api/routes/demo.ts",
    "src/api/routes/engine.ts",
    "src/api/routes/health.ts"
)

# 16. feat(simulator): add seeded multi-device telemetry generator and historical backfill
Commit-Step "feat(simulator): add seeded multi-device telemetry generator and historical backfill" @(
    "scripts/simulate.ts",
    "scripts/seed-history.ts"
)

# 17. feat(web): build thermal strip-chart recorder frontend with light and night themes
Commit-Step "feat(web): build thermal strip-chart recorder frontend with light and night themes" @(
    "web"
)

# 18. test: implement unit tests for adapters, temporal classifier, and query router table
Commit-Step "test: implement unit tests for adapters, temporal classifier, and query router table" @(
    "tests/adapters.test.ts",
    "tests/classifier.test.ts",
    "tests/router.test.ts"
)

# 19. test: implement real MongoDB integration test suite and CI workflow
Commit-Step "test: implement real MongoDB integration test suite and CI workflow" @(
    "tests/integration.test.ts",
    ".github"
)

# 20. bench: implement write throughput, query plan explain, storage and late data lab benchmarks
Commit-Step "bench: implement write throughput, query plan explain, storage and late data lab benchmarks" @(
    "scripts/bench-all.ts",
    "scripts/bench-late.ts",
    "scripts/bench-query-plans.ts",
    "scripts/bench-router.ts",
    "scripts/bench-storage.ts",
    "scripts/bench-throughput.ts",
    "scripts/generate-benchmarks-md.ts",
    "scripts/git-commits.ps1",
    "results",
    "BENCHMARKS.md"
)

# 21. docs: add comprehensive README with architectural diagrams, demo graphic, and audited benchmarks
Commit-Step "docs: add comprehensive README with architectural diagrams, demo graphic, and audited benchmarks" @(
    "README.md",
    "demo.svg"
)

Write-Host "All 21 commits completed successfully!"
git log --oneline -n 25
