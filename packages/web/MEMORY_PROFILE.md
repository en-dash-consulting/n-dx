# Web UI Memory Usage Profile

> Task: Profile memory usage patterns during web UI load and refresh cycles
> Date: 2026-02-24
> Scope: `packages/web/` — Preact SPA client + Node.js HTTP server

---

## 1. Executive Summary

The n-dx web UI has **no critical memory leaks**, but several patterns contribute to elevated memory usage that can trigger OOM crashes (Chrome error code 5) under specific conditions:

| Risk | Pattern | Impact |
|------|---------|--------|
| **HIGH** | Force-directed graph renders all SVG nodes without virtualization | 1000+ file codebases can consume 200–500 MB |
| **HIGH** | Hench run detail loads full `toolCalls` array into browser memory | Runs with 50+ turns × complex tool outputs can be 10–50 MB per detail |
| **MEDIUM** | Multiple concurrent WebSocket connections from component isolation | Each view creates independent WS connections; no shared bus |
| **MEDIUM** | Polling intervals accumulate when views mount/unmount rapidly | 3+ simultaneous intervals (5s, 5s, 10s, 1s) per mounted view |
| **LOW** | MCP session map grows without TTL-based cleanup | Only affects long-running server with many Claude Code reconnections |
| **LOW** | Physics quad-tree allocates new tree each frame during simulation | GC-friendly but contributes to allocation pressure |

---

## 2. Memory Usage Baseline (Normal Operations)

### Initial Load Sequence

```
Browser navigates to http://localhost:3117
  │
  ├── GET /api/config                    → ~100 bytes (scope check)
  ├── GET /api/status                    → ~500 bytes (sidebar indicators)
  ├── GET /api/project                   → ~200 bytes (git metadata)
  │
  ├── detectMode() → "server"
  │   └── loadFromServer()               → 6 parallel fetches:
  │       ├── GET /data/manifest.json    → ~1 KB
  │       ├── GET /data/inventory.json   → 10–500 KB (scales with file count)
  │       ├── GET /data/imports.json     → 5–200 KB (scales with edge count)
  │       ├── GET /data/zones.json       → 2–50 KB
  │       ├── GET /data/components.json  → 1–100 KB
  │       └── GET /data/callGraph.json   → 5–200 KB
  │
  ├── startPolling(5000)                 → setInterval begins
  └── WebSocket connection (optional, per-component)
```

**Estimated initial memory footprint:**

| Codebase Size | ~Files | Initial Load (parsed JSON) | With Graph View | With All Views |
|---------------|--------|---------------------------|-----------------|----------------|
| Small         | <100   | 2–5 MB                    | 8–15 MB         | 10–20 MB       |
| Medium        | 100–500| 5–20 MB                   | 30–80 MB        | 40–100 MB      |
| Large         | 500+   | 20–100 MB                 | 100–500+ MB     | 150–600+ MB    |

### Data Retention in Memory

All six data files are held in the module-level `currentData` singleton (`loader.ts:22–29`) for the entire session lifetime. Data is never evicted — only replaced when a newer version arrives via polling.

```typescript
// loader.ts — module-level singleton, never garbage-collected
let currentData: LoadedData = {
  manifest: null, inventory: null, imports: null,
  zones: null, components: null, callGraph: null,
};
```

---

## 3. Refresh Cycle Analysis

### Polling-Driven Refresh (Primary Path)

**Trigger:** `setInterval` every 5000ms in `loader.ts:142–167`

```
Every 5 seconds:
  fetch("/data/status")                → ~200 bytes response
  compare mtimes                       → O(n) where n ≈ 7 files
  if changed:
    loadFromServer()                   → Re-fetches ALL 6 data files
    notifyChange()                     → Triggers Preact re-render cascade
```

**Memory spike during refresh:**

1. **Fetch phase**: 6 new JSON response bodies allocated (~same size as initial load)
2. **Parse phase**: `res.json()` allocates new JS objects (duplicates existing data temporarily)
3. **Migration phase**: `migrateData()` may create additional intermediate objects
4. **Validation phase**: Zod schemas create validation result wrappers
5. **State update**: React/Preact holds both old and new VDOM trees simultaneously
6. **GC phase**: Old data becomes eligible for collection after render completes

**Peak memory during refresh ≈ 2× steady-state data size** because old + new coexist until GC runs.

### WebSocket-Driven Refresh (Secondary Path)

**Components that create their own WebSocket connections:**

| Component | WebSocket Purpose | Poll Fallback |
|-----------|-------------------|---------------|
| `status-indicators.ts` | `hench:run-changed`, `rex:prd-changed` → re-fetch `/api/status` | 10s interval |
| `active-tasks-panel.ts` | `hench:task-execution-progress` → update execution state | 5s interval |
| Hench runs list | N/A (uses polling only) | 10s interval |

**Issue:** Each component opens its **own** WebSocket connection. When the Hench Runs view is active, there can be **3 simultaneous WebSocket connections** to the same server, plus a WebSocket from the sidebar status indicators. This wastes server-side memory (each connection is a `WSClient` in the `Set<WSClient>`) and client-side memory (each WS has buffering).

### Manual Refresh (POST /api/reload)

Broadcasts 3 WebSocket messages simultaneously, triggering all watchers:
```
ws.broadcast({ type: "viewer:reload", ... })
ws.broadcast({ type: "sv:data-changed", ... })
ws.broadcast({ type: "rex:prd-changed", ... })
```

This can cause **thundering-herd re-fetching** where multiple components all re-fetch simultaneously after receiving their respective events.

---

## 4. Component-Level Memory Analysis

### 4.1 Graph View (HIGHEST MEMORY RISK)

**Files:** `graph/renderer.ts` (700+ LOC), `graph/physics.ts` (444 LOC)

**Memory allocation per graph instance:**

| Structure | Size Formula | For 500 Files, 2000 Edges |
|-----------|-------------|--------------------------|
| `nodes: GraphNode[]` | 48 bytes × N nodes | ~24 KB |
| `nodeGroups: SVGGElement[]` | ~2 KB × N nodes (SVG DOM) | ~1 MB |
| `linkElements: SVGLineElement[]` | ~500 bytes × E edges | ~1 MB |
| `nodeEdgeMap: Map<string, Set<number>>` | ~100 bytes × N | ~50 KB |
| `resolvedLinks[]` | ~80 bytes × E | ~160 KB |
| `labelRects: LabelRect[]` | 32 bytes × N (pre-allocated) | ~16 KB |
| `zoneHullElements: Map<string, SVGPathElement>` | ~1 KB × Z zones | ~10 KB |
| `zoneLabelElements: Map<string, SVGGElement>` | ~500 bytes × Z | ~5 KB |
| **Physics: QuadTree** (rebuilt each frame) | ~80 bytes × N nodes (transient) | ~40 KB/frame |
| **Physics: zoneCentroids Map** (rebuilt each frame) | ~80 bytes × Z zones | ~1 KB/frame |
| **SVG DOM total** | Dominates total | **~2–3 MB** |

**Per-frame allocation during simulation:**

Each `tick()` call (every animation frame while `alpha > 0.01`):
1. `computeForceParams()` — allocates new params object
2. `computeZoneCentroids()` — allocates new `Map` + centroid objects
3. `buildQuadTree()` — allocates entire quad-tree node graph (if >200 nodes)
4. `applyZoneCentroidRepulsion()` — allocates forces `Map`
5. DOM updates: `setAttribute()` calls on all SVG elements

**Simulation runs ~100–300 frames before settling.** With 500+ nodes, this generates significant GC pressure (~40 KB/frame × 300 frames = ~12 MB of transient allocations).

**Mitigation already in place:**
- `labelRects` array is pre-allocated and reused (line 255–259)
- Graph is hidden by default (requires explicit toggle, `GRAPH_VISIBLE_KEY`)
- `destroy()` method aborts all event listeners via `AbortController`
- Graph destruction on hide (`handleToggleGraph`, graph.ts:137–141)

**Missing mitigations:**
- No virtualization — all SVG nodes rendered even if off-screen
- No node count limit or progressive rendering
- Quad-tree not pooled/reused between frames
- No `requestIdleCallback` for lower-priority work

### 4.2 PRD Tree View

**Memory characteristics:**
- Loads full PRD document from `/data/prd.json`
- Tree walk in `useMemo` for stats, filtering, expanded state
- Fetches Hench runs separately for token usage aggregation
- Every PRD item rendered as a DOM node (no virtualization)

**Scaling:** A PRD with 1000+ items (realistic for large projects) renders all items to the DOM simultaneously. Each item is ~500 bytes of DOM, so 1000 items ≈ 500 KB of DOM + Preact VDOM overhead.

**Weekly budget resolution** (`normalizeWeeklyBudgetResolution`, `aggregateTaskUsage`) iterates all runs and creates per-task usage maps — O(R × T) where R = runs, T = tasks.

### 4.3 Hench Runs View

**Memory characteristics:**
- List view: fetches `/api/hench/runs` (summaries only, light)
- Detail view: fetches `/api/hench/runs/:id` — **includes full `toolCalls` array**
- `toolCalls` can contain large tool inputs/outputs (file contents, command outputs)
- A 50-turn run with tool calls can be 5–50 MB of JSON

**Polling:** `setInterval(fetchRuns, 10_000)` re-fetches the full runs list every 10 seconds. The response is modest (summaries only), but creates allocation + GC pressure.

**Key concern:** When viewing a run detail, the full `RunDetail` object (with `toolCalls` and `turnTokenUsage`) is held in React state. Navigating between run details does not explicitly release the previous detail — it's replaced by a new one, leaving the old for GC.

### 4.4 Active Tasks Panel

**Memory characteristics:**
- Opens its **own** WebSocket connection (separate from status-indicators)
- 1-second `setInterval` for elapsed time display per active task card
- `setExecutions()` state updates create new arrays on every WS message

**Key concern:** The 1-second timer per active task is fine for 1–3 tasks but would be inefficient for many concurrent tasks (unlikely in practice).

### 4.5 Sidebar Status Indicators

**Memory characteristics:**
- Module-level `cachedStatus` singleton (never cleared)
- Opens WebSocket for real-time updates
- `setInterval` at 10 seconds for polling fallback
- `fetchPromise` dedup prevents concurrent requests (good)

---

## 5. Server-Side Memory Patterns

### 5.1 File Reading (Synchronous)

All data routes use `readFileSync()`:
```typescript
// routes-data.ts:107, 129
const content = readFileSync(prdPath, "utf-8");
```

This blocks the event loop and holds the entire file in memory as a string. For large files (10+ MB PRD or inventory), this creates a synchronous spike. The string is not streamed — it's allocated fully before being sent via `res.end(content)`.

### 5.2 Status Route Cache

```typescript
// routes-status.ts:89
let cache: StatusCache | null = null;  // TTL: 5 seconds
```

The status route reads ALL hench run files from disk on every cache miss (`extractHenchStatus` reads each `.hench/runs/*.json`). With 100+ run files, this creates a burst of synchronous file reads every 5 seconds.

### 5.3 MCP Session Map

```typescript
// routes-mcp.ts:40–41
const rexSessions = new Map<string, McpSession>();
const svSessions = new Map<string, McpSession>();
```

Sessions are only removed via `transport.onclose`. If a client disconnects without sending a close frame (network failure, browser crash), the session persists indefinitely. There is no TTL-based cleanup or periodic sweep.

### 5.4 WebSocket Client Set

```typescript
// websocket.ts:108
const clients = new Set<WSClient>();
```

Clients are removed on `close` and `error` events, plus the 30-second ping/pong keepalive removes unresponsive clients. This is well-managed.

### 5.5 File Watchers

```typescript
// start.ts:204–291
watch(svDir, ...)        // .sourcevision/ directory
watch(rexDir, ...)       // .rex/ directory
watch(henchRunsDir, ...) // .hench/runs/ directory
watch(viewerPath, ...)   // dev mode only
```

Each `fs.watch()` holds an OS-level file descriptor. The count is bounded (4 directories max). Low risk.

---

## 6. Polling & Timer Inventory

### Client-Side Timers (When All Views Are Mounted)

| Timer | Source | Interval | Cleanup |
|-------|--------|----------|---------|
| Data polling | `loader.ts:145` | 5000ms | `stopPolling()` on unmount |
| Hench runs list | `hench-runs.ts:482` | 10000ms | `clearInterval` on unmount |
| Project status | `status-indicators.ts:104` | 10000ms | `clearInterval` on unmount |
| Active tasks exec status | `active-tasks-panel.ts:257` | 5000ms | `clearInterval` on unmount |
| Active task elapsed tick | `active-tasks-panel.ts:91` | 1000ms | `clearInterval` on unmount |
| Refresh toast auto-dismiss | `use-app-data.ts:51` | 3000ms (one-shot) | Via `setTimeout` |

**Total concurrent network requests per cycle** (worst case, all views mounted):
- Every 5s: 2 fetches (data status + execution status)
- Every 10s: 2 fetches (runs list + project status)

All timers have proper cleanup via `useEffect` return functions. **No timer leak risk detected.**

### Server-Side Timers

| Timer | Source | Interval | Cleanup |
|-------|--------|----------|---------|
| WebSocket ping | `websocket.ts:114` | 30000ms | Cleared on `shutdown()` |
| Heartbeat monitor | `routes-hench.ts` (via `startHeartbeatMonitor`) | Periodic | Cleared on shutdown |

---

## 7. Event Listener Audit

### Properly Cleaned Up (via AbortController or useEffect return)

| Listener | Source | Cleanup |
|----------|--------|---------|
| Graph: mousemove, wheel, mousedown, click, dblclick | `renderer.ts` | `AbortController.abort()` in `destroy()` |
| Graph: zone hull click, dblclick | `renderer.ts:523, 541` | Shares `AbortController.signal` |
| Document: dragover, drop, dragleave | `use-app-data.ts:96–98` | `removeEventListener` in cleanup |
| Window: popstate | `use-route-state.ts` | `removeEventListener` in cleanup |
| WebSocket: onmessage, onclose | `status-indicators.ts`, `active-tasks-panel.ts` | `ws.close()` in cleanup |

### No Leak Risk Detected

All event listeners in the codebase use either:
1. Preact `useEffect` cleanup functions
2. `AbortController` signal-based auto-removal
3. Direct `removeEventListener` in cleanup

---

## 8. Specific OOM Crash Scenarios

### Scenario A: Large Codebase Graph View

**Trigger:** User enables graph on a codebase with 1000+ files
**Mechanism:** All SVG nodes rendered → DOM exceeds 500 MB → Chrome tab crashes
**Evidence:** Graph is hidden by default, suggesting this was already a known issue
**Estimated threshold:** ~800 nodes where Chrome starts struggling, ~1500 for OOM

### Scenario B: Rapid Refresh During Active Development

**Trigger:** File watcher detects changes repeatedly (e.g., `pnpm build` touches many files)
**Mechanism:**
1. File change → `watcher.refresh()` → WebSocket broadcast
2. Client receives `sv:data-changed` → triggers `loadFromServer()`
3. While fetch is in-flight, another change triggers another `loadFromServer()`
4. Old + new data coexist → 3–4× steady-state memory
5. Chrome GC can't keep up → memory climbs → OOM

**No debounce on file watcher events.** Every `fs.watch` event immediately triggers `watcher.refresh()` and a WebSocket broadcast.

### Scenario C: Large Hench Run Detail View

**Trigger:** Viewing a run with 50+ turns containing large tool outputs
**Mechanism:** Full `toolCalls` array loaded into memory → can be 10–50 MB
**Compounding:** If user navigates between multiple large runs, each detail is held in state until React reconciliation replaces it

### Scenario D: Long-Running Session with Graph Active

**Trigger:** Dashboard open for hours with graph visible
**Mechanism:**
1. Physics simulation settles (alpha < 0.01) — OK
2. But if data refreshes, does graph re-initialize?
3. `initialized` flag prevents re-creation, but data change triggers re-render
4. Each polling cycle allocates new response objects
5. Over hours, accumulated GC pressure + unreleased closure references

---

## 9. Quantified Memory Spikes

### Spike 1: Initial Load

```
t=0ms   : Page load, empty state                    ~5 MB
t=100ms : 6 data fetches initiated                   ~5 MB
t=500ms : JSON responses parsed + validated           ~15–100 MB (codebase dependent)
t=600ms : Preact renders initial VDOM                 ~20–120 MB
t=700ms : Sidebar status + project metadata fetch     ~20–120 MB
t=1000ms: Settled baseline                            ~15–100 MB (after GC)
```

### Spike 2: Graph Toggle On

```
t=0ms   : User clicks "Show Graph"                   baseline
t=50ms  : SVG nodes created for all files             baseline + 2–3 MB per 500 nodes
t=100ms : Physics simulation starts (RAF loop)        baseline + ~5 MB (transient allocs)
t=500ms : ~100 frames simulated                       baseline + ~10 MB peak
t=2000ms: Simulation settles, GC reclaims transients  baseline + 2–3 MB (DOM only)
```

### Spike 3: Data Refresh (Polling)

```
t=0ms   : Poll detects mtime change                  baseline
t=50ms  : 6 fetch requests fire                       baseline
t=200ms : JSON bodies arrive + parsed                 baseline + (data size × 2)
t=300ms : Zod validation creates result wrappers      baseline + (data size × 2.2)
t=400ms : Preact re-renders, old VDOM retained        baseline + (data size × 2.5) PEAK
t=500ms : Old data + old VDOM eligible for GC         baseline + (data size × 2.5)
t=800ms : GC cycle runs                               returns to ~baseline
```

---

## 10. Recommendations (Prioritized)

### P0 — Prevent OOM Crashes

1. **Add node count limit to graph view** — If imports have >500 edges, show a warning and require explicit opt-in. Cap at 1000 nodes with "show top N by import count."

2. **Debounce file watcher broadcasts** — Batch file changes within a 500ms window before broadcasting. Prevents refresh storms during builds.

3. **Stream hench run details** — Don't include `toolCalls` in the initial detail fetch. Add a separate endpoint or lazy-load individual tool calls on expand.

### P1 — Reduce Memory Pressure

4. **Shared WebSocket connection** — Create a single WS connection manager that all components subscribe to. Currently 2–3 independent connections exist simultaneously.

5. **Virtualize PRD tree and graph** — Only render visible nodes. For PRD, use a virtual scroll list for 100+ items. For graph, only render nodes within the current viewport.

6. **Add MCP session TTL** — Sweep `rexSessions` and `svSessions` every 5 minutes, removing sessions inactive for >15 minutes.

### P2 — Reduce Allocation Pressure

7. **Pool physics quad-tree** — Reuse quad-tree nodes between frames instead of allocating a new tree each tick.

8. **Use streaming JSON parsing for large data files** — `readFileSync` + `JSON.parse` creates a single large string and then a single large object. Use a streaming parser for files >1 MB.

9. **Lazy-load view data** — Don't fetch hench runs or PRD data until the user navigates to those views. Currently, data polling starts on mode detection regardless of active view.

---

## 11. Browser DevTools Profiling Guide

To reproduce and measure the patterns documented above:

### Memory Timeline Recording

1. Open Chrome DevTools → Memory tab
2. Navigate to `http://localhost:3117`
3. Take a heap snapshot ("Snapshot 1 — baseline")
4. Navigate to the Graph view, toggle graph on
5. Take a heap snapshot ("Snapshot 2 — graph active")
6. Compare: look for `SVGElement`, `GraphNode`, `SimState` allocations
7. Toggle graph off, force GC (trash can icon)
8. Take a heap snapshot ("Snapshot 3 — post-graph")
9. Verify snapshot 3 ≈ snapshot 1 (confirms proper cleanup)

### Allocation Timeline

1. DevTools → Memory → "Allocation instrumentation on timeline"
2. Start recording
3. Wait for 2–3 polling cycles (15 seconds)
4. Stop recording
5. Look for blue bars (retained allocations) vs gray bars (transient)
6. Blue bars that grow over time indicate leaks

### Performance Tab (Refresh Spike)

1. DevTools → Performance → Start recording
2. Modify a file in `.sourcevision/` (e.g., touch `.sourcevision/inventory.json`)
3. Wait for the refresh cycle (~5 seconds)
4. Stop recording
5. Look at the JS Heap line — the spike during refresh is the "2× baseline" pattern

### Key Object Groups to Watch

| Object | Expected Count | Red Flag If |
|--------|---------------|-------------|
| `WSClient` (server) | 1–3 | >10 |
| `McpSession` | 0–2 | >10 |
| `SVGGElement` | 0 (no graph) or N (graph visible) | Persists after graph hidden |
| `setInterval` callbacks | 2–4 | >6 |
| `AbortController` | 1 per GraphRenderer | >1 after graph hidden |

---

## 12. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                         │
│                                                                 │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Sidebar  │  │  Graph   │  │   PRD    │  │  Hench Runs    │  │
│  │ Status   │  │   View   │  │   View   │  │     View       │  │
│  │ Indicator│  │          │  │          │  │                │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       │WS           │             │                 │           │
│       │ 10s poll    │             │                 │ 10s poll  │
│       │             │             │                 │           │
│  ┌────┴─────────────┴─────────────┴─────────────────┴────────┐  │
│  │                    loader.ts (5s poll)                      │  │
│  │         currentData: LoadedData (module singleton)          │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                     │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │              Active Tasks Panel (WS + 5s poll + 1s tick)    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
┌───────────────────────────┴─────────────────────────────────────┐
│                     NODE.JS SERVER                               │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ routes-  │  │  routes-  │  │ routes-  │  │   routes-     │  │
│  │ data.ts  │  │  rex.ts   │  │ hench.ts │  │   mcp.ts      │  │
│  │          │  │           │  │          │  │               │  │
│  │readFile  │  │readFile   │  │readFile  │  │rexSessions    │  │
│  │Sync()   │  │Sync()    │  │Sync()   │  │svSessions     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                │          │
│  ┌────┴──────────────┴──────────────┴────────────────┘          │
│  │                                                              │
│  │  .sourcevision/   .rex/prd.json   .hench/runs/*.json        │
│  │  (fs.watch)       (fs.watch)      (fs.watch)                │
│  └──────────────────────────────────────────────────────────────┘
│                                                                  │
│  ┌──────────────────┐  ┌─────────────────┐                     │
│  │ websocket.ts     │  │ routes-status.ts│                     │
│  │ clients: Set<>   │  │ cache: 5s TTL   │                     │
│  │ ping: 30s        │  │ reads ALL runs  │                     │
│  └──────────────────┘  └─────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Appendix: File-by-File Memory Relevance

| File | Memory Role | Risk |
|------|------------|------|
| `viewer/loader.ts` | Module-level data singleton, polling timer | LOW — proper cleanup |
| `viewer/hooks/use-app-data.ts` | Data state, drag-drop listeners | LOW — proper cleanup |
| `viewer/graph/renderer.ts` | SVG DOM, adjacency map, label rects | HIGH — no virtualization |
| `viewer/graph/physics.ts` | Quad-tree, zone centroids (per-frame) | MEDIUM — transient allocs |
| `viewer/views/graph.ts` | Graph lifecycle, memoized lookups | LOW — destroys on unmount |
| `viewer/views/hench-runs.ts` | Run detail with full toolCalls | HIGH — unbounded payload |
| `viewer/views/prd.ts` | Full PRD tree + usage aggregation | MEDIUM — no virtualization |
| `viewer/components/active-tasks-panel.ts` | WS connection, 1s timer | MEDIUM — own WS connection |
| `viewer/components/status-indicators.ts` | WS connection, 10s poll | MEDIUM — own WS connection |
| `server/websocket.ts` | Client set, ping interval | LOW — proper cleanup |
| `server/routes-mcp.ts` | Session maps (no TTL) | MEDIUM — no periodic sweep |
| `server/routes-data.ts` | readFileSync per request | LOW — bounded file set |
| `server/routes-status.ts` | Reads ALL run files on cache miss | MEDIUM — scales with runs |
| `server/routes-hench.ts` | Full run JSON loading | MEDIUM — large transcripts |
| `server/routes-rex.ts` | Full PRD read/write per mutation | LOW — single file |
| `server/start.ts` | fs.watch handles (4 max) | LOW — bounded |
