# Process Lifecycle Audit: Dashboard Startup & Teardown

**Date:** 2026-02-24
**Task:** d788c225 — Audit current dashboard process spawning and lifecycle management
**Scope:** `packages/web/`, `web.js`, `packages/llm-client/src/exec.ts`

---

## 1. Process Inventory

### 1.1 Processes Spawned During Dashboard Startup

When `ndx start .` runs (foreground or background), the following processes and in-process resources are created:

| # | Resource | Type | Spawned By | When |
|---|----------|------|------------|------|
| 1 | Orchestrator (`web.js`) | OS process | User / shell | Immediately |
| 2 | Server process (`packages/web/src/cli/index.ts`) | OS child process (`spawn --detached`) | `web.js` (background mode only) | On `--background` |
| 3 | HTTP server (`http.Server`) | In-process listener | `start.ts` `startServer()` | During `serve` command |
| 4 | WebSocket manager | In-process (raw upgrade handler) | `start.ts` `startServer()` | When first WS upgrade arrives |
| 5 | Hench task child (`spawnManaged`) | OS child process | `routes-hench.ts` `handleExecute()` | When user starts a task via dashboard |
| 6 | Rex epic-runner child (`spawnManaged`) | OS child process | `routes-rex.ts` `runHenchForEpic()` | When user starts epic-by-epic execution |
| 7 | MCP session handlers | In-process state (no separate process) | `routes-mcp.ts` | On first MCP HTTP request |
| 8 | WS ping/keepalive interval | In-process `setInterval` | `websocket.ts` | When first WebSocket client connects |

**Note:** Background mode wraps items 3–8 inside item 2 — a single detached child process that outlives `web.js`.

---

### 1.2 Port Bindings

| Port / Resource | Bound By | Who Uses It |
|----------------|----------|-------------|
| TCP `3117` (default), range `3117–3200` | `start.ts` `server.listen(actualPort)` | HTTP requests + WebSocket upgrades + MCP HTTP |
| `.n-dx-web.pid` (file) | `web.js` after server is ready | `ndx start status`, `ndx start stop` |
| `.n-dx-web.port` (file) | `start.ts` inside server process | `web.js` background polling; MCP tool callers |

Only **one TCP port** is bound per server run. WebSocket and MCP share the HTTP port via `upgrade` events and URL-path routing respectively.

**Port allocation algorithm** (`packages/web/src/server/port.ts`):

1. Try preferred port (default `3117`) with up to 5 retries, exponential back-off starting at 100 ms.
2. If still unavailable, scan `3117–3200` for the first free port.
3. Server binds, writes the actual port to `.n-dx-web.port`.

---

### 1.3 Worker Threads

**None.** The dashboard uses no `worker_threads`. All compute is done in the main event loop or delegated to child processes via `spawnManaged`.

---

## 2. Process Creation — Code Locations

### 2.1 Background Server Spawn (`web.js`)

```
web.js  line 391
  spawn(process.execPath, [script, ...serveArgs], { detached: true, stdio: "ignore" })
  child.unref()
```

- **Detached + unref'd** — parent (`web.js`) exits immediately; child continues as a daemon.
- `serveArgs` includes `--port=<N>` and the project directory.
- PID written to `.n-dx-web.pid` by the **orchestrator** (`web.js`) after the port file appears.

### 2.2 Hench Task Child (`routes-hench.ts`)

```
routes-hench.ts  POST /api/hench/execute/:taskId  →  handleExecute()
  spawnManaged(binPath, binArgs, { cwd, stdio: "inherit", env })
```

- `binPath` = `node_modules/.bin/hench`
- `binArgs` = `["run", "--task=<taskId>", projectDir]`
- Handle stored in `activeExecutions` Map keyed by `taskId`.
- **Multiple concurrent executions possible** — one per task.

### 2.3 Rex Epic-Runner Child (`routes-rex.ts`)

```
routes-rex.ts  runHenchForEpic(ctx, epicId)
  spawnManaged(binPath, binArgs, { cwd, stdio: "inherit", env })
```

- `binArgs` = `["run", "--epic=<epicId>", "--loop", "--auto", projectDir]`
- Handle stored in **module-level singleton** `henchProcess`.
- **Only one instance at a time** — controlled by `executionState.status`.

---

## 3. Cleanup Procedures & Signal Handlers

### 3.1 Signal Handler Map

| Location | Signal | Action |
|----------|--------|--------|
| `web.js` lines 442–448 | `SIGINT`, `SIGTERM` | Remove `.n-dx-web.pid` + `.n-dx-web.port`; log "stopping" |
| `start.ts` `registerShutdownHandlers()` lines 90–91 | `SIGINT`, `SIGTERM` (2nd) | `process.exit(1)` — escape hatch during stuck shutdown |
| `start.ts` `registerShutdownHandlers()` lines 140–141 | `SIGINT`, `SIGTERM` | `gracefulShutdown()` — 4-step coordinated teardown |
| `start.ts` `registerShutdownHandlers()` line 144 | `exit` | `unlink(portFilePath)` — safety net |

### 3.2 Graceful Shutdown Sequence (`start.ts`)

```
SIGINT / SIGTERM
  │
  ├─ [timeout sentinel] 30 s (N_DX_SHUTDOWN_TIMEOUT_MS) → process.exit(1)
  │
  ├─ Step 1 – Child processes (parallel):
  │    shutdownActiveExecutions()    [routes-hench.ts]
  │      └─ killWithFallback(handle, 5 s) for each active hench task
  │    shutdownRexExecution()        [routes-rex.ts]
  │      └─ killWithFallback(henchProcess, 5 s)
  │
  ├─ Step 2 – WebSocket:
  │    ws.shutdown()                 [websocket.ts]
  │      ├─ clearInterval(pingInterval)
  │      └─ encodeCloseFrame() + socket.destroy() for each client
  │
  ├─ Step 3 – HTTP server:
  │    server.close(callback)
  │      └─ Stop accepting connections; drain in-flight requests
  │
  └─ Step 4 – Port file:
       unlink(portFilePath)
       process.exit(0)
```

### 3.3 `killWithFallback` Protocol (`packages/llm-client/src/exec.ts`)

For every spawned `ManagedChild`:

1. Send `SIGTERM`.
2. Wait up to `gracePeriodMs` (default 5 000 ms) for the child's `close` event.
3. If still alive → send `SIGKILL`.
4. Wait up to 1 000 ms for `close`, then continue regardless.

### 3.4 WebSocket Ping/Keepalive

- `setInterval` at 30 s, started when the first client connects.
- Missed pong → client removed from `clients` set + socket destroyed.
- Interval cleared in `ws.shutdown()` — **no leak**.

### 3.5 MCP Sessions

MCP sessions are in-memory state (Map of session objects). No OS resources are held beyond the HTTP server socket. Session teardown is implicit when the HTTP server closes.

---

## 4. Processes Lacking Proper Cleanup

### 4.1 Status After Recent Fixes

| Gap | Description | Status |
|-----|-------------|--------|
| **GAP-1** | `routes-rex.ts` `henchProcess` singleton was not terminated during server shutdown | ✅ **Fixed** in commit `c65d2b8` — `shutdownRexExecution()` exported and wired into `gracefulShutdown` |

### 4.2 Remaining Issues

#### GAP-2: Orchestrator Does Not Propagate Signals to Server Child (Low Severity)

**Location:** `web.js` SIGINT/SIGTERM handler (lines 442–448)

**Problem:** `web.js`'s cleanup handler removes PID/port files but does **not** explicitly send a signal to the child server process. In foreground mode, the shell sends `SIGINT` to the entire process group, so the server process also receives it — this works by accident. In background mode (`--detached`), the child is in its own session; `web.js`'s signal handler doesn't reach it.

**Impact:** `ndx start stop` path sends `SIGTERM` to the PID stored in `.n-dx-web.pid`, which correctly targets the server — this is the intended stop mechanism. The gap only appears if `web.js` itself is killed while a background server is running, in which case the background server continues running unattended (but intact).

**Severity:** Low — the PID file mechanism covers the primary stop path.

#### GAP-3: Hench `run.ts` Handles SIGINT but Not SIGTERM (Low Severity)

**Location:** `packages/hench/src/cli/run.ts`

**Problem:** Hench's graceful "finish current tool call, then stop" logic is wired to `SIGINT` only. When `killWithFallback()` sends `SIGTERM` (the first signal in the escalation), the hench process receives it but has no handler — default behavior is immediate termination. SIGTERM kills hench without the two-stage cleanup it performs for SIGINT.

**Impact:** Hench child may leave intermediate state (incomplete tool results, partial file writes) when killed from the dashboard. The hench run record may be marked as failed rather than interrupted.

**Severity:** Low for correctness; medium for observability. Hench already records each turn as it progresses, so partial state is recoverable from the run history.

#### GAP-4: No Process Group Kill for Deep Process Trees (Informational)

**Location:** `killWithFallback()` in `packages/llm-client/src/exec.ts`

**Problem:** `kill(pid, SIGTERM)` targets a single PID. If a hench child itself spawns grandchildren (e.g., Claude CLI subprocess during tool use), those grandchildren are not explicitly killed. On Linux/macOS they may survive if they have been adopted by init (if hench unref'd them).

**Current mitigation:** Hench's own `run.ts` graceful shutdown terminates its Claude subprocess when SIGINT is received. SIGTERM (from the dashboard) bypasses this — see GAP-3.

**Severity:** Informational — depends on Claude CLI's own signal handling. No confirmed orphan reports.

---

## 5. Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │  web.js (orchestrator, foreground/exit)  │
                         │  SIGINT/SIGTERM → rm .pid + .port files  │
                         └──────────────┬──────────────────────────┘
                                        │ spawn --detached (background mode)
                                        ▼
        ┌───────────────────────────────────────────────────────────────┐
        │  Server Process (packages/web/src/cli/index.ts → start.ts)   │
        │                                                               │
        │  ┌─────────────────────────────────────────────────────────┐ │
        │  │ http.Server  (port 3117..3200)                          │ │
        │  │   ├── HTTP routes (all /api/* paths)                    │ │
        │  │   ├── WebSocket upgrade → WebSocketManager             │ │
        │  │   │     └── setInterval(30s ping)                       │ │
        │  │   └── /mcp/* → MCP session handlers (in-memory)        │ │
        │  └──────────────────────────────────────────────────────── ┘ │
        │                                                               │
        │  ┌─────────────────┐    ┌──────────────────────────────────┐ │
        │  │ activeExecutions │    │ henchProcess (singleton)          │ │
        │  │ Map<taskId,      │    │ (null | ManagedChild)            │ │
        │  │   ManagedChild>  │    │ routes-rex.ts epic-runner        │ │
        │  │ routes-hench.ts  │    └──────────────────┬───────────────┘ │
        │  └────────┬─────── ┘                        │                 │
        │           │ spawnManaged                     │ spawnManaged    │
        │           ▼                                  ▼                 │
        │  ┌──────────────────┐             ┌──────────────────────┐   │
        │  │  hench child(ren)│             │  hench epic-runner   │   │
        │  │  (one per task)  │             │  (one at a time)     │   │
        │  └──────────────────┘             └──────────────────────┘   │
        └───────────────────────────────────────────────────────────────┘
```

---

## 6. Environment Variables Reference

| Variable | Default | Scope | Purpose |
|----------|---------|-------|---------|
| `N_DX_STOP_GRACE_MS` | `2000` | `web.js` | Grace period before SIGKILL in `ndx start stop` |
| `N_DX_SHUTDOWN_TIMEOUT_MS` | `30000` | `start.ts` | Hard timeout for full server shutdown |
| `HENCH_SHUTDOWN_TIMEOUT_MS` | `5000` | `routes-hench.ts`, `routes-rex.ts` | Per-child SIGTERM→SIGKILL grace period |

---

## 7. Summary

The dashboard startup spawns **one HTTP server** (which doubles as WebSocket and MCP host) and, on demand, **one or more hench child processes** for task execution. Process management is handled via the `ManagedChild` abstraction with `killWithFallback` escalation.

**Cleanup coverage as of 2026-02-24:**

- ✅ HTTP server — graceful close (drains in-flight requests)
- ✅ WebSocket clients — close frames sent, sockets destroyed, interval cleared
- ✅ Hench task children (`activeExecutions`) — SIGTERM (5 s) → SIGKILL
- ✅ Rex epic-runner child (`henchProcess`) — SIGTERM (5 s) → SIGKILL *(fixed c65d2b8)*
- ✅ Port files — removed on exit and in `exit` safety handler
- ✅ MCP sessions — no OS resources, implicit teardown

**Remaining gaps (no blocking issues):**

- ⚠️ GAP-2: `web.js` doesn't explicitly signal its background child if the orchestrator itself is killed
- ⚠️ GAP-3: Hench `run.ts` graceful shutdown wired to SIGINT only; SIGTERM skips it
- ℹ️ GAP-4: No process group kill; grandchildren of hench could theoretically survive
