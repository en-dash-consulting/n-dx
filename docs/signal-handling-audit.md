# Signal Handling Audit

**Date:** 2026-02-24
**Scope:** SIGINT, SIGTERM, process lifecycle across web, hench, rex, sourcevision packages
**Task ID:** 6de57b7c-db77-450a-98d3-ca0fe66e0621

---

## Summary

| Location | SIGINT | SIGTERM | exit event | Notes |
|----------|--------|---------|------------|-------|
| `web.js` | ✅ → cleanup | ✅ → cleanup | — | Removes PID + port files |
| `cli.js` | ✅ (readline AbortController) | — | — | Global uncaughtException/unhandledRejection |
| `packages/hench` run.ts | ✅ graceful loop stop | — | — | Double-signal → force exit |
| `packages/web` start.ts | ✅ 4-step graceful | ✅ 4-step graceful | ✅ port file removal | Best-in-class; double-signal escalation |
| `packages/rex` CLI | ❌ none | ❌ none | ❌ none | Acceptable — short-lived commands only |
| `packages/sourcevision` CLI | ❌ none | ❌ none | ❌ none | Acceptable — short-lived commands only |

**Gap identified:** `packages/web/src/server/routes-rex.ts` spawns a `henchProcess` for the "run epics" execution path that is **not** cleaned up during server shutdown.

---

## Detailed Inventory

### 1. `web.js` — Web Server Orchestrator

**Signals handled:** SIGINT, SIGTERM

```js
// Lines 442-449
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});
```

**Cleanup procedure:**
```js
const cleanup = () => Promise.all([
  removePidFile(absDir).catch(() => {}),
  removePortFile(absDir).catch(() => {}),
]);
```

- Removes `.n-dx-web.pid` (PID registry)
- Removes `.n-dx-web.port` (port registry)
- No child process termination in `web.js` itself (delegates to the web package's `registerShutdownHandlers`)

**Process kill utilities used:**
- `process.kill(pid, 0)` — liveness probe (line 171)
- `process.kill(info.pid, "SIGTERM")` — graceful stop attempt (line 227)
- `process.kill(info.pid, "SIGKILL")` — force kill after grace period (line 240)
- Grace period controlled by `N_DX_STOP_GRACE_MS` environment variable

---

### 2. `cli.js` — CLI Orchestrator

**Signals handled:** SIGINT (scoped), uncaughtException, unhandledRejection

#### Interactive readline prompt (scoped SIGINT)

```js
const abort = new AbortController();
const onSigint = () => abort.abort();
process.once("SIGINT", onSigint);
try {
  const answer = await rl.question("Enter choice [1-2]: ", { signal: abort.signal });
} finally {
  process.removeListener("SIGINT", onSigint);
  rl.close();
}
```

Uses `AbortController` to cancel the prompt cleanly; listener is always removed in `finally`.

#### Global error handlers

```js
process.on("uncaughtException", (err) => {
  console.error(formatError(err));
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(formatError(err));
  process.exit(1);
});
```

Ensures unexpected errors exit with code 1 and print a formatted message.

#### Conflicting dashboard termination (pre-refresh)

Uses `process.kill(pid, "SIGTERM")` + grace period + `process.kill(pid, "SIGKILL")` via `detectAndCleanConflictingDashboard()`.

---

### 3. `packages/hench/src/cli/commands/run.ts` — Agent Loop

**Signals handled:** SIGINT (two-stage)

#### `runLoop()` — continuous task loop

```ts
const ac = new AbortController();
let stopping = false;

const onSignal = () => {
  if (stopping) {
    process.exit(1);  // Second Ctrl-C: force exit immediately
  }
  stopping = true;
  ac.abort();         // Abort interruptible pause
  info("\nReceived interrupt — finishing current task then stopping…");
};

process.on("SIGINT", onSignal);

try {
  while (true) {
    if (stopping) break;
    // ... execute task ...
    await loopPause(pauseMs, ac.signal);  // interrupted by abort
  }
} finally {
  process.removeListener("SIGINT", onSignal);
}
```

**Cleanup procedure:**
1. First SIGINT: set `stopping = true`, abort the inter-task pause (returns early), finish the current task naturally, then exit the loop.
2. Second SIGINT: `process.exit(1)` immediately.
3. Always removes listener in `finally` to avoid listener leak.

#### `runEpicByEpic()` — epic-batched loop

Identical two-stage pattern. Same `AbortController` usage for interruptible pauses.

#### `loopPause()` — interruptible timer

```ts
export function loopPause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(timer); resolve(); };
      if (signal.aborted) { clearTimeout(timer); resolve(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
```

Clears the timer immediately on abort — no dangling timers.

---

### 4. `packages/web/src/server/start.ts` — Web Server Shutdown Coordinator

**Signals handled:** SIGINT, SIGTERM, exit event

#### `registerShutdownHandlers()`

```ts
process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("exit", () => { unlink(portFilePath).catch(() => {}); });
```

**Four-step graceful shutdown sequence:**

| Step | Action | Purpose |
|------|--------|---------|
| 1 | `shutdownActiveExecutions()` | Terminate hench child processes (SIGTERM → SIGKILL escalation) |
| 2 | `ws.shutdown()` | Send RFC 6455 close frames; destroy sockets |
| 3 | `server.close()` | Stop accepting connections; drain in-flight requests |
| 4 | `unlink(portFilePath)` | Remove port file so orchestrator sees port as free |

**Timeout:** controlled by `N_DX_SHUTDOWN_TIMEOUT_MS` (default 30 000 ms). Arms `setTimeout` with `.unref()` so a clean shutdown doesn't block on the timer.

**Double-signal escalation:**
```ts
const gracefulShutdown = async (signal: string): Promise<void> => {
  process.once("SIGINT", () => forceExit("SIGINT"));
  process.once("SIGTERM", () => forceExit("SIGTERM"));
  // ... graceful steps ...
};
```
Re-registers for the second signal → calls `process.exit(1)` immediately.

**Safety net:**
```ts
process.once("exit", () => { unlink(portFilePath).catch(() => {}); });
```
Removes port file even if graceful path never runs (e.g., uncaught exception).

---

### 5. `packages/web/src/server/routes-hench.ts` — Hench Task Execution

**Active process tracking:** `Map<taskId, { handle: ManagedChild, state, runId }>`

**Shutdown export:**
```ts
export async function shutdownActiveExecutions(
  gracePeriodMs = Number(process.env["HENCH_SHUTDOWN_TIMEOUT_MS"] ?? 5_000),
): Promise<void>
```
Called by `start.ts` as Step 1 of graceful shutdown. Uses `killWithFallback()` for each entry: SIGTERM → wait `gracePeriodMs` → SIGKILL if still alive.

**Manual termination (API endpoint):**
```ts
entry.handle.kill("SIGTERM");
activeExecutions.delete(taskId);
```

---

### 6. `packages/web/src/server/routes-rex.ts` — Rex Execution (Epic Runner)

**Active process tracking:** `let henchProcess: ManagedChild | null = null` (module-level singleton)

**On pause API call:**
```ts
if (henchProcess) {
  henchProcess.kill("SIGINT");
  henchProcess = null;
}
```

**⚠️ Gap — not cleaned up on server shutdown.** `shutdownActiveExecutions()` in `routes-hench.ts` only manages its own `activeExecutions` Map. The `henchProcess` in `routes-rex.ts` is a separate reference that is **not** included in the shutdown sequence. If a rex-driven epic execution is running when SIGINT/SIGTERM arrives, that child process will be orphaned.

---

### 7. `packages/web/src/server/websocket.ts` — WebSocket Manager

**Shutdown method (called by start.ts Step 2):**
```ts
function shutdown(): void {
  clearInterval(pingInterval);
  for (const client of clients) {
    client.socket.write(encodeCloseFrame());  // RFC 6455 code 1000
    client.socket.destroy();
  }
  clients.clear();
}
```

Ping interval uses `.unref()` so it doesn't prevent process exit.

---

### 8. `packages/llm-client/src/exec.ts` — Kill Utilities (Foundation Layer)

**`killWithFallback(handle, gracePeriodMs = 5000)`**

```ts
handle.kill("SIGTERM");
await Promise.race([handle.done, timeout(gracePeriodMs)]);
if (timedOut) {
  handle.kill("SIGKILL");
  await Promise.race([handle.done, timeout(SHUTDOWN_KILL_ESCALATION_MS)]);
}
```

Used by `routes-hench.ts:shutdownActiveExecutions()`. Never rejects — errors during kill are silently swallowed.

---

### 9. `packages/rex` CLI — No Signal Handlers

Rex CLI commands (`init`, `status`, `add`, `update`, `validate`, `analyze`, `recommend`, `mcp`) are short-lived processes that complete and exit normally. No cleanup is needed. Only `process.exit(0/1)` for help/error paths.

**Acceptable.** Signal handling would add complexity without benefit for single-invocation tools.

---

### 10. `packages/sourcevision` CLI — No Signal Handlers

Same as rex. Short-lived analysis commands. Only `process.exit(0/1)` at boundary conditions.

**Acceptable.** The `serve` subcommand delegates to the web package which has its own signal handling.

---

## Environment Variable Controls

| Variable | Default | Controls |
|----------|---------|---------|
| `N_DX_SHUTDOWN_TIMEOUT_MS` | `30000` | Overall web server shutdown deadline |
| `HENCH_SHUTDOWN_TIMEOUT_MS` | `5000` | Per-execution SIGTERM→SIGKILL grace period |
| `N_DX_STOP_GRACE_MS` | (in web.js) | CLI-level grace period when stopping a running server |

---

## Identified Gaps

### GAP-1: `routes-rex.ts` henchProcess not cleaned up on server shutdown

**File:** `packages/web/src/server/routes-rex.ts`
**Variable:** `let henchProcess: ManagedChild | null = null` (line 1971)
**Impact:** If a rex epic-runner execution is in progress when the web server receives SIGINT/SIGTERM, the child `hench` process is not terminated. It continues running as an orphan, holds port/lock resources, and may conflict with subsequent server starts.

**Fix:** Export a `shutdownRexExecution()` function from `routes-rex.ts` (analogous to `shutdownActiveExecutions` in `routes-hench.ts`) and call it as an additional step in `start.ts`'s `gracefulShutdown()`.

### GAP-2: `web.js` cleanup does not terminate child processes

**File:** `web.js`
**Impact:** `web.js` runs as the outer orchestrator. Its SIGINT/SIGTERM handlers only remove PID and port files; they do not propagate the signal to the inner web server process. However, in practice the inner server process typically receives the terminal signal directly (same process group), so this is lower severity. A `--background` daemon mode (via `--detach`) could break this assumption.

### GAP-3: No SIGTERM handler in hench `run.ts`

**File:** `packages/hench/src/cli/commands/run.ts`
**Impact:** Only SIGINT (Ctrl-C) is handled. When hench is terminated programmatically (e.g., by `routes-rex.ts` calling `handle.kill("SIGTERM")` or `handle.kill("SIGKILL")`), the graceful "finish current task" logic does not run — the process exits abruptly mid-task. This is intentional for force-kill paths but may leave partial task state.

---

## Recommended Next Steps

1. **Fix GAP-1 (critical):** Add `shutdownRexExecution()` to `routes-rex.ts` and wire it into `start.ts`.
2. **Assess GAP-3:** Determine whether SIGTERM should trigger the same graceful loop in hench (finishing the current API call before exiting), or whether abrupt termination is acceptable for the server-driven case.
3. **Test coverage:** Add integration tests for server SIGTERM with active rex epic-runner execution to confirm cleanup.
