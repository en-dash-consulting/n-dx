# Test Stabilization Hotfix Guide

**Branch:** `hotfix/test-bugs` (fork: `en-dash-consulting/n-dx-internal`)
**Target:** `add-unit-tests-to-CICD-and-fix-existing-tests` (upstream: `en-dash-consulting/n-dx`)
**Commit:** `87b51975` — _Stabilize test suite: fix flaky timing, process cleanup, and test isolation_

This document describes every change in the hotfix commit, why it was needed, and how it relates to the target branch. The goal is to ensure the upstream branch incorporates the performance test stabilization and child process cleanup fixes so CI passes reliably.

---

## 1. Test Script Splitting (package.json changes)

### Files changed
- `packages/rex/package.json`
- `packages/sourcevision/package.json`
- `packages/web/package.json`

### What changed
Each package's `"test"` script was split into two phases:

```jsonc
// Before
"test": "vitest run"

// After (rex / sourcevision)
"test": "pnpm run test:unit && pnpm run test:e2e",
"test:unit": "vitest run tests/unit tests/integration",
"test:e2e": "vitest run tests/e2e --no-file-parallelism"

// After (web)
"test": "pnpm run test:unit && pnpm run test:integration",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run tests/integration --no-file-parallelism"
```

### Why
E2E tests that spawn servers (MCP transport, `cli-serve`, web dashboard) compete for ports and filesystem resources when vitest runs them in parallel. The `--no-file-parallelism` flag serializes e2e test files while keeping unit tests fully parallel, preventing port collisions and flaky teardown races in CI.

---

## 2. Browser Storage Setup File

### Files changed
- `packages/web/tests/setup/browser-storage.ts` (new)
- `packages/web/vitest.config.ts`

### What changed
Added a vitest setup file that installs `localStorage` and `sessionStorage` stubs on `globalThis` and `window` before each test. The vitest config registers it:

```ts
setupFiles: ["tests/setup/browser-storage.ts"]
```

### Why
Several viewer tests rely on `localStorage`/`sessionStorage` but jsdom does not always provide them consistently across environments. This caused `ReferenceError` failures in CI that did not reproduce locally. The setup file guarantees a clean, spec-compliant storage stub for every test.

---

## 3. Performance Test Stabilization

### Files changed
- `packages/web/tests/unit/viewer/large-tree-performance.test.ts`
- `packages/web/tests/unit/viewer/dom-performance-monitor.test.ts`

### What changed

#### `timedMedianBatch` helper (large-tree-performance)
A new helper function batches 50 executions per sample across 31 iterations (odd count for a true median):

```ts
function timedMedianBatch(fn: () => void, batchCount = 50, iterations = 31): number {
  return timedMedian(() => {
    for (let i = 0; i < batchCount; i++) { fn(); }
  }, iterations);
}
```

All six scaling regression tests (`computeBranchStats`, `diffItems`, `filterTree`, `countVisibleNodes`, `sliceVisibleTree`, `applyItemUpdate`) were migrated from single-call `timedMedian` to `timedMedianBatch`.

#### Ratio thresholds
Scaling ratio thresholds were widened from `8` to `12`. For a 4x tree size increase (500 to 2000 nodes), linear scaling would yield a ratio of ~4. A threshold of 12 still catches quadratic regressions (which would show ~16) while tolerating the scheduler noise and CPU contention present during full monorepo CI runs.

#### DOM counting (dom-performance-monitor)
- The absolute timing assertion for the 1000-element counting test was relaxed from 50ms to 100ms to account for jsdom overhead under CI load.
- The linearity test adopted the same batching strategy (25 executions per sample) and the 12x ratio threshold.

### Why
The `filterTree scales linearly with tree size` test was the primary CI failure. The 500-node tree operation completed in sub-millisecond time, making the ratio extremely sensitive to scheduling jitter. Batching pushes both the small-tree and large-tree measurements well above the noise floor, producing stable ratios that reflect algorithmic cost rather than system noise.

---

## 4. Child Process Cleanup

### Files changed
- `tests/e2e/mcp-transport.test.js`
- `packages/sourcevision/tests/e2e/cli-serve.test.ts`

### What changed

Both test files spawn a server as a child process. The fixes are identical in pattern:

1. **Spawn with `detached: true`** to create a new process group
2. **Kill via process group** (`process.kill(-pid, "SIGTERM")`) instead of just the wrapper process
3. **SIGKILL fallback** after a 3-second timeout if SIGTERM doesn't work
4. **Await the `close` event** before proceeding to tmpdir cleanup

#### mcp-transport.test.js (before/after)
```js
// Before
serverProcess = spawn("node", [CLI_PATH, "start", ...], { stdio: "pipe" });
// afterAll:
serverProcess.kill("SIGTERM");

// After
serverProcess = spawn("node", [CLI_PATH, "start", ...], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
// afterAll:
if (proc.pid) {
  try { process.kill(-proc.pid, "SIGTERM"); } catch { /* already dead */ }
}
await new Promise((resolve) => {
  proc.on("close", () => resolve());
  setTimeout(() => {
    if (proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL"); } catch { /* already dead */ }
    }
    resolve();
  }, 3000);
});
```

#### cli-serve.test.ts
Same pattern, with a reusable `killTree(pid)` helper extracted.

### Why
The `ndx start` orchestrator spawns a child web server process. Killing only the parent with `SIGTERM` leaves the child server alive, holding the port open. In CI this caused:
- Subsequent tests failing to bind to the expected port
- Vitest warning about open handles and hanging on exit
- Zombie processes accumulating across test file boundaries

The `detached` + process group kill pattern ensures the entire process tree is terminated.

---

## 5. Broadcast Wait Fix (routes-hench-execute)

### File changed
- `packages/web/tests/unit/server/routes-hench-execute.test.ts`

### What changed
Replaced a fixed `setTimeout(200ms)` with a polling `waitFor` helper:

```ts
async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

// Usage: wait for broadcast to report completed/failed
await waitFor(() =>
  broadcastMessages.some((msg) => {
    const state = msg.state;
    return state?.status === "completed" || state?.status === "failed";
  }),
);
```

### Why
The 200ms sleep was a race condition. On slower CI runners, the hench process spawn + completion cycle took longer than 200ms, causing the test to check broadcast messages before any arrived. The polling approach waits for the actual event with a generous 5-second ceiling.

---

## 6. cli-init Test Restructuring

### File changed
- `tests/e2e/cli-init.test.js`

### What changed
Split the combined `"persists both providers through config get pathway"` test (which looped over `["codex", "claude"]`) into two independent test cases with a shared helper:

```js
async function expectProviderPersistsThroughConfigGet(provider, stdout) { ... }

it("persists codex through config get pathway", async () => {
  await expectProviderPersistsThroughConfigGet("codex", "ok");
});

it("persists claude through config get pathway", async () => {
  await expectProviderPersistsThroughConfigGet("claude", '{"result":"ok"}');
});
```

### Why
When a looped test fails, the error message doesn't indicate which provider iteration failed. Separate test cases give clear failure attribution in CI output and allow independent re-runs.

---

## 7. Token Usage Route Timeout

### File changed
- `packages/web/tests/integration/token-usage-route-regression.test.ts`

### What changed
Extended the test timeout from the default (5s) to 10s:

```ts
}, 10_000);
```

### Why
This integration test boots the full viewer and waits for route rendering. Under CI load, the jsdom environment initialization occasionally exceeded the 5-second default, causing a timeout failure unrelated to the code under test.

---

## 8. Bug Fix: go-route-detection `inferPrefix`

### File changed
- `packages/sourcevision/src/analyzers/go-route-detection.ts`

### What changed
```ts
// Before
while (!paths[i].startsWith(prefix)) {
  const lastSlash = prefix.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  prefix = prefix.slice(0, lastSlash + 1);
}

// After
while (!paths[i].startsWith(prefix)) {
  const candidate = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const lastSlash = candidate.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  prefix = candidate.slice(0, lastSlash + 1);
}
```

### Why
When all routes shared a common prefix ending in `/` (e.g., `/api/`), `lastIndexOf("/")` found the trailing slash itself, sliced to `lastSlash + 1`, and produced the same string — creating an infinite loop. Stripping the trailing slash before searching ensures the loop always makes progress upward through path segments.

---

## 9. Known Issue on Target Branch: `search-overlay.test.ts`

### File
- `packages/web/tests/unit/viewer/search-overlay.test.ts`

### Problem
The `useSearchOverlay` describe block (line 377 on the target branch) calls `cleanup(root)` in its `afterEach`, but `cleanup` is not defined or imported in that scope. The first describe block (`SearchOverlay`) imports and uses `cleanupRenderedDiv` from `../../helpers/preact-test-support.js`, but the second describe block was not updated to match.

```ts
// Line 376-378 on target branch — broken
afterEach(() => {
  if (root) cleanup(root);  // ReferenceError: cleanup is not defined
});
```

### Fix
Replace `cleanup(root)` with `cleanupRenderedDiv(root)` in the `useSearchOverlay` afterEach block:

```ts
afterEach(() => {
  if (root) cleanupRenderedDiv(root);
});
```

This fix needs to be applied on the `add-unit-tests-to-CICD-and-fix-existing-tests` branch directly, as the error originates from that branch's version of the file. The hotfix branch (`hotfix/test-bugs`) does not modify `search-overlay.test.ts`.

### CI Error
```
ReferenceError: cleanup is not defined
 > tests/unit/viewer/search-overlay.test.ts:377:15
```
4 tests fail: `opens on Ctrl+K`, `opens on Cmd+K (metaKey)`, `toggles on repeated Ctrl+K`, `does not open on plain K without modifier`.

---

## Summary of Changes by Category

| Category | Files | Impact |
|----------|-------|--------|
| Test script splitting | 3 package.json files | Prevents port/filesystem contention in e2e tests |
| Browser storage stubs | 1 new setup file + vitest config | Fixes jsdom storage ReferenceErrors |
| Performance batching | 2 test files | Eliminates flaky scaling ratio failures |
| Child process cleanup | 2 test files | Prevents zombie processes and port leaks in CI |
| Broadcast wait fix | 1 test file | Removes race condition in hench execute test |
| Test restructuring | 1 test file | Better CI failure attribution |
| Timeout extension | 1 test file | Prevents false timeout in integration test |
| Bug fix | 1 source file | Fixes infinite loop in Go route prefix detection |
| Target branch fix needed | 1 test file (not in hotfix) | `search-overlay.test.ts` cleanup import |
