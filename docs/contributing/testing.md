# Testing Conventions

## Test Directory Structure

Every package maintains three test tiers:

```
packages/<name>/tests/
  unit/           # Isolated function/class tests (no I/O, no network)
  integration/    # In-process contract tests (real stores, gateways, pipelines)
  e2e/            # Full CLI/process tests (spawn commands, validate output)
  fixtures/       # Shared test data
```

## Test Tiers

### Unit Tests

Pure function tests with no I/O or network access. Fast and deterministic.

```sh
pnpm --filter rex test          # run all rex tests
pnpm --filter rex exec vitest run tests/unit/  # unit tests only
```

### Integration Tests

In-process contract tests that exercise real stores, gateways, and pipelines.

| Package | Required scenarios |
|---------|-------------------|
| rex | Store mutation, tree traversal, task selection with real PRDStore |
| sourcevision | Analyzer pipeline phases, zone detection with real file inventory |
| hench | Gateway re-export validation, agent loop with mocked LLM responses |
| web | Cross-zone boundary checks, gateway re-export validation, messaging pipeline |
| llm-client | Adapter resolution, config loading with real filesystem |

### E2E Tests

Full CLI/process tests that spawn compiled `dist/` binaries. Root-level e2e tests use plain `.js` (no build step required). Package-internal tests use `.ts`.

### Gateway Admission Criterion

Any new gateway module **must** have a corresponding integration test in the same PR:

1. **Re-export existence** — every symbol is callable/constructible
2. **Contract correctness** — at least one end-to-end scenario through the gateway
3. **Type alignment** — re-exports match upstream public API

## Required Tests

These tests are the sole coverage point for critical startup paths and must not be deleted:

| Test | Covers |
|------|--------|
| `tests/e2e/cli-dev.test.js` | `ndx dev` command startup |
| `tests/integration/scheduler-startup.test.js` | Usage cleanup scheduler boot |

Required tests contain the annotation `REQUIRED TEST` (case-insensitive), machine-verified by `architecture-policy.test.js`.

## Utility + Hook Testing

When a feature has a standalone utility with a framework hook wrapper, **both layers need dedicated tests**:

| Layer | Test focus |
|-------|-----------|
| Utility (`<feature>.test.ts`) | Pure logic: data structures, computations, lifecycle |
| Hook (`use-<feature>.test.ts`) | Framework integration: mount, unmount, prop changes |

## Test Format

| Scope | Format | Reason |
|-------|--------|--------|
| Root e2e tests | `.js` | Spawn compiled `dist/` binaries, no source imports |
| Package tests | `.ts` | Compiled with the package |

## Running Tests

```sh
pnpm test           # all packages
pnpm build && pnpm test  # build first (required for e2e)
pnpm --filter <pkg> test # single package
```
