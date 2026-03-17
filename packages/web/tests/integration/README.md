# Web Integration Tests

## Build-freshness precondition

Integration tests in this directory validate **built artifacts** (e.g., `dist/viewer/`,
`dist/landing/`, `dist/server/`). If you modify source files without rebuilding, tests
will silently validate stale output.

**Before running integration tests after source changes:**

```sh
pnpm --filter @n-dx/web build && pnpm --filter @n-dx/web test
```

The `build-output-contract.test.ts` test verifies artifact existence but cannot detect
staleness. A full rebuild ensures tests reflect current source.

> **Note:** The `@n-dx/web` package does not have a `pretest` or `prebuild` script that
> automatically triggers a build before testing. The rebuild step is manual and
> intentional — adding an automatic prebuild would slow down rapid test iteration during
> development. Keep this in mind when investigating unexpected test failures after source
> changes.

## Test inventory

| Test file | Coverage area |
|-----------|--------------|
| `build-output-contract.test.ts` | Build output existence and structural markers |
| `boundary-check.test.ts` | Server/viewer/shared import boundary enforcement |
| `request-dedup.test.ts` | Request deduplication pipeline |
| `messaging-stack.test.ts` | WebSocket messaging pipeline |
| `pr-markdown-refresh.test.ts` | PR markdown generation refresh |
| `pr-markdown-tab-parity.test.ts` | PR markdown tab parity |
| `smart-add-dispatch.test.ts` | Smart add UI dispatch |
| `ws-health-integration.test.ts` | WebSocket health checks |
| `background-suspension-recovery.test.ts` | Background tab polling suspension |
| `memory-aware-polling-suspension.test.ts` | Memory-pressure polling controls |
| `token-usage-route-regression.test.ts` | Token usage API route stability |
