# Resource Allocation Catalog: Dashboard Operation

**Date:** 2026-02-24
**Task:** d8d4d862 — Identify and catalog all port bindings and resource allocations
**Scope:** `packages/web/`, `web.js`

This document is a focused reference for all network ports, file handles, and system
resources allocated during dashboard operation. For process-lifecycle and signal-handling
details see [`process-lifecycle-audit.md`](./process-lifecycle-audit.md) and
[`signal-handling-audit.md`](./signal-handling-audit.md).

---

## 1. Port Bindings

### 1.1 HTTP / WebSocket / MCP Port (Single Binding)

| Property | Value |
|----------|-------|
| **Default port** | `3117` |
| **Fallback range** | `3117–3200` (sequential scan) |
| **Protocol** | TCP |
| **Bound by** | `start.ts` `server.listen(actualPort)` |
| **Shared over** | HTTP requests, WebSocket upgrades (`Upgrade` header), MCP Streamable HTTP (`/mcp/*`) |
| **Source** | `packages/web/src/server/port.ts` — `DEFAULT_PORT`, `PORT_RANGE_START`, `PORT_RANGE_END` |

Only **one TCP port** is bound per server run. All three protocols (HTTP, WebSocket, MCP)
share that single port via in-process routing:

- HTTP routes are matched by URL path prefix (`/api/*`, `/data/*`, `/mcp/*`, `/`).
- WebSocket upgrades are detected via the `upgrade` event on `http.Server`.
- MCP sessions are routed by URL path (`/mcp/rex`, `/mcp/sourcevision`).

**Port allocation algorithm** (`packages/web/src/server/port.ts`):

1. Try preferred port (from `--port` flag → `.n-dx.json` → env `PORT` → `3117`) with up
   to 5 retries, exponential back-off starting at 100 ms × 2 multiplier.
2. `EACCES` (permission denied) → fail immediately; no fallback.
3. After retry exhaustion → scan `3117–3200` sequentially for the first free port.
4. Server binds and writes the actual port to `.n-dx-web.port`.

**No other TCP or UDP ports are bound.**

---

## 2. File Handles

### 2.1 Written Files (Server Creates / Owns)

| File | Created By | Contents | Removed By |
|------|-----------|----------|------------|
| `.n-dx-web.port` | Server process (`start.ts` line 502) | Actual bound port number (plain text) | Step 4 of graceful shutdown; `exit` safety handler |
| `.n-dx-web.pid` | Orchestrator (`web.js`) after reading port file | `{"pid":N,"port":N,"startedAt":"…"}` | `web.js` SIGINT/SIGTERM handler; `ndx start stop` |

Both files live in the project root directory (the path passed to `ndx start`).

### 2.2 Read-Only Files Opened at Runtime

| File | Reader | When |
|------|--------|------|
| `.n-dx.json` | `web.js`, `start.ts` | Once at startup; not re-read |
| `.hench/config.json` | `routes-hench.ts` | On each relevant API request |
| `.hench/runs/*.json` | `routes-hench.ts` | On status/run-list API requests |
| `.rex/prd.json` | `routes-rex.ts` | On each relevant API request |
| `.rex/config.json` | `routes-rex.ts` | On startup and config API requests |
| `.sourcevision/CONTEXT.md` | `routes-sourcevision.ts` | On `sv_context` API requests |
| `.sourcevision/manifest.json` | `routes-sourcevision.ts` | On `sv_inventory` and related requests |

These files are opened, read, and closed on demand. No persistent file descriptors are
held between requests.

### 2.3 File Watchers (fs.watch)

`fs.watch()` registers kernel-level directory watchers. Each occupies a file descriptor
in the server process.

| Watcher | Directory Watched | Trigger Condition | WebSocket Event | Created In |
|---------|-----------------|------------------|-----------------|-----------|
| Sourcevision watcher | `.sourcevision/` | File in `ALL_DATA_FILES` list | `sv:data-changed` | `start.ts` `registerSourcevisionWatcher()` |
| Rex watcher | `.rex/` | `prd.json` changes | `rex:prd-changed` | `start.ts` `registerRexWatcher()` |
| Hench watcher | `.hench/runs/` | Any `*.json` file | `hench:run-changed` | `start.ts` `registerHenchWatcher()` |
| Dev viewer watcher | `dirname(viewerPath)` | `index.html` changes | `viewer:reload` | `start.ts` `registerDevViewerWatcher()` (dev mode only) |

Watchers are **not** explicitly `.close()`d during shutdown. They are implicitly released
when the process exits. The `fs.watch` call is wrapped in try/catch because it is not
guaranteed on all filesystems.

---

## 3. In-Process Resources

### 3.1 Timers

| Timer | Interval | Purpose | Created By | Cleanup |
|-------|----------|---------|------------|---------|
| WebSocket ping keepalive | 30 s | Detect dead clients (no-pong → destroy socket) | `websocket.ts` — on first client connect | `clearInterval()` in `ws.shutdown()` — **explicit, no leak** |
| Heartbeat monitor | 30 s | Detect unresponsive hench runs; broadcast `hench:heartbeat-alert` | `routes-hench.ts` `startHeartbeatMonitor()` | `.unref()` called at line 1201 — won't block exit, but timer is never explicitly cleared |
| Task state transition | One-shot 1 s | Transition hench task from `"starting"` to `"running"` | `routes-hench.ts` `handleExecute()` | Self-cancels after firing |

### 3.2 Child Processes

| Resource | Command | Count | Spawned By | Cleanup |
|----------|---------|-------|-----------|---------|
| Hench task runner | `hench run --task=<id>` | 0–N concurrent | `routes-hench.ts` `handleExecute()` via `spawnManaged` | `shutdownActiveExecutions()` → `killWithFallback(5 s SIGTERM→SIGKILL)` |
| Rex epic-by-epic runner | `hench run --epic=<id> --loop --auto` | 0–1 (singleton) | `routes-rex.ts` `runHenchForEpic()` via `spawnManaged` | `shutdownRexExecution()` → `killWithFallback(5 s SIGTERM→SIGKILL)` |
| Background server process | `node packages/web/dist/cli/index.js serve` | 0–1 (background mode only) | `web.js` via `spawn --detached` | `ndx start stop` sends SIGTERM to PID in `.n-dx-web.pid` |

### 3.3 In-Memory State Maps

| Object | Location | Contents | Lifetime |
|--------|----------|----------|---------|
| `activeExecutions` | `routes-hench.ts` module scope | `Map<taskId, {runId, handle, state}>` | Entries added on task start, removed on completion |
| `henchProcess` | `routes-rex.ts` module scope | `ManagedChild \| null` — rex epic-runner singleton | Set during run, nulled on exit |
| `rexSessions` | `routes-mcp.ts` module scope | `Map<sessionId, {transport, server}>` | Entry per active MCP client; removed on transport close |
| `svSessions` | `routes-mcp.ts` module scope | `Map<sessionId, {transport, server}>` | Entry per active MCP client; removed on transport close |
| `alertedRuns` | `routes-hench.ts` `startHeartbeatMonitor()` closure | `Map<runId, HeartbeatStatus>` | Lives for server lifetime (no eviction) |

### 3.4 HTTP Server

| Property | Detail |
|----------|--------|
| Type | `http.Server` (Node.js built-in) |
| Created | `start.ts` `createServer(requestHandler)` |
| Holds | One TCP socket per in-flight HTTP connection |
| Cleanup | `server.close(callback)` in graceful shutdown step 3 — stops accepting; drains active requests |

### 3.5 WebSocket Connections

| Property | Detail |
|----------|--------|
| Type | Raw RFC 6455 framing over `http.Server` `upgrade` event |
| Created | `start.ts` `createWebSocketManager()` |
| State | `Set<{socket: Socket, alive: boolean}>` — one entry per connected browser tab |
| Cleanup | `ws.shutdown()` in graceful shutdown step 2: `clearInterval(ping)`, close frame to each client, `socket.destroy()` |

---

## 4. Resource Cleanup Procedures

### 4.1 Four-Step Graceful Shutdown (`start.ts`)

Triggered by SIGINT or SIGTERM. A `N_DX_SHUTDOWN_TIMEOUT_MS`-second (default 30 s)
watchdog fires `process.exit(1)` if any step stalls.

```
Step 1 — Child processes (parallel, up to 5 s each)
  shutdownActiveExecutions()   → SIGTERM each hench task child → SIGKILL after 5 s
  shutdownRexExecution()       → SIGTERM rex epic-runner     → SIGKILL after 5 s

Step 2 — WebSocket connections
  ws.shutdown()  → clearInterval(ping) → RFC 6455 close frame → socket.destroy()

Step 3 — HTTP server
  server.close(callback)   → stop accepting; drain in-flight requests

Step 4 — Port file + exit
  unlink(.n-dx-web.port) → process.exit(0)
```

Second SIGINT/SIGTERM during shutdown → `process.exit(1)` immediately (escape hatch).

### 4.2 `killWithFallback` Protocol (`packages/llm-client/src/exec.ts`)

Applied to every child process in steps 1:

1. `child.kill("SIGTERM")` — request cooperative shutdown.
2. Wait up to `HENCH_SHUTDOWN_TIMEOUT_MS` (default 5 000 ms) for `close` event.
3. If still alive → `child.kill("SIGKILL")` — force terminate.
4. Wait up to 1 000 ms for `close`, then continue regardless.

### 4.3 Orchestrator Cleanup (`web.js`)

`web.js` installs SIGINT/SIGTERM handlers that remove `.n-dx-web.pid` and
`.n-dx-web.port`. This is the **orchestrator** cleanup path (foreground mode only).
The detached server process runs its own graceful shutdown independently.

### 4.4 Forced Stop (`ndx start stop`)

Reads PID from `.n-dx-web.pid`, sends SIGTERM, waits `N_DX_STOP_GRACE_MS` (default
2 000 ms), sends SIGKILL if still running.

---

## 5. Resource Summary Table

| Resource | Count | Lifespan | Cleanup | Notes |
|----------|-------|---------|---------|-------|
| TCP port (HTTP/WS/MCP) | 1 | Full server run | `server.close()` step 3 | Shared by all protocols |
| `.n-dx-web.port` file | 1 | Server run | Removed step 4 + `exit` handler | Signals readiness to orchestrator |
| `.n-dx-web.pid` file | 1 | Orchestrator run | `web.js` SIGINT/SIGTERM | Background mode only |
| `http.Server` | 1 | Full server run | `server.close()` step 3 | |
| WebSocket manager | 1 | Full server run | `ws.shutdown()` step 2 | |
| WebSocket clients | 0–N | Per-connection | Close frame + destroy step 2 | |
| WS ping interval | 1 | First client → shutdown | `clearInterval` step 2 | Explicit, no leak |
| Heartbeat monitor timer | 1 | Full server run | `.unref()` only — implicit exit | Doesn't block exit |
| `fs.watch` (sv dir) | 0–1 | Full server run | Implicit on exit | Conditional on scope |
| `fs.watch` (rex dir) | 0–1 | Full server run | Implicit on exit | Conditional on scope |
| `fs.watch` (hench dir) | 0–1 | Full server run | Implicit on exit | Conditional on scope |
| `fs.watch` (viewer dir) | 0–1 | Full server run | Implicit on exit | Dev mode only |
| Hench task children | 0–N | Per task | `killWithFallback` step 1 | |
| Rex epic-runner child | 0–1 | Per epic run | `killWithFallback` step 1 | |
| MCP session objects | 0–M | Per MCP client | Implicit on HTTP server close | No OS resources |
| `activeExecutions` map | 1 | Full server run | Entries removed per task | |
| `rexSessions` / `svSessions` maps | 2 | Full server run | Entries removed per MCP session | |

---

## 6. Environment Variable Controls

| Variable | Default | Scope | Effect |
|----------|---------|-------|--------|
| `N_DX_SHUTDOWN_TIMEOUT_MS` | `30000` | `start.ts` | Hard deadline for full shutdown; `process.exit(1)` on breach |
| `HENCH_SHUTDOWN_TIMEOUT_MS` | `5000` | `routes-hench.ts`, `routes-rex.ts` | SIGTERM→SIGKILL grace period per child |
| `N_DX_STOP_GRACE_MS` | `2000` | `web.js` | Grace period in `ndx start stop` before SIGKILL |
| `PORT` | — | `web.js` | Alternative to `--port` flag for port selection |

---

## 7. Known Gaps

| Gap | Location | Description | Severity |
|-----|----------|-------------|---------|
| Heartbeat monitor not explicitly cleared | `routes-hench.ts` line 1201 | `startHeartbeatMonitor()` timer has no exported cleanup function; relies on `.unref()` + process exit | Low — `.unref()` prevents blocking exit |
| `fs.watch` handles not explicitly closed | `start.ts` watcher registration | Watcher objects are not stored and closed during shutdown | Low — released implicitly on exit |
| `web.js` doesn't signal background child on SIGINT/SIGTERM | `web.js` lines 442–448 | Orchestrator removes PID/port files but doesn't send signal to the detached server process | Low — `ndx start stop` is the intended stop path |
| Hench `run.ts` handles SIGINT but not SIGTERM | `packages/hench/src/cli/run.ts` | Two-stage graceful shutdown only activates on SIGINT; SIGTERM uses default (immediate) termination | Medium for observability; low for correctness |
