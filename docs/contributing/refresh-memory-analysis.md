# 2026-03-03 — Refresh Task Orchestration Memory Analysis

Analysis of the `ndx refresh` command and web UI refresh behaviors, cataloguing
operations that load data into memory and assessing their memory footprint.

---

## 1. Data File Inventory

Current on-disk sizes of all data files involved in refresh operations:

| File | Location | Size | Loaded by refresh? |
|------|----------|------|--------------------|
| `callgraph.json` | `.sourcevision/` | **24 MB** | Deferred (browser), snapshot (CLI) |
| `prd.json` | `.rex/` | **828 KB** | Yes — browser fetch on every refresh signal |
| `imports.json` | `.sourcevision/` | 574 KB | Deferred (browser), snapshot (CLI) |
| `inventory.json` | `.sourcevision/` | 298 KB | Deferred (browser), snapshot (CLI) |
| `zones.json` | `.sourcevision/` | 195 KB | Priority load (browser), snapshot (CLI) |
| `classifications.json` | `.sourcevision/` | 172 KB | Not loaded by viewer |
| `llms.txt` | `.sourcevision/` | 100 KB | Not loaded by viewer |
| `pr-markdown.md` | `.sourcevision/` | 189 KB | Not loaded by viewer |
| `CONTEXT.md` | `.sourcevision/` | 24 KB | Snapshot (CLI) |
| `components.json` | `.sourcevision/` | 20 KB | Deferred (browser), snapshot (CLI) |
| `manifest.json` | `.sourcevision/` | 1.8 KB | Priority load (browser), snapshot (CLI) |
| Zone output files | `.sourcevision/zones/` | 3.6 MB total (~90 zones) | Not loaded by refresh |
| Hench run files | `.hench/runs/` | 6.9 MB total (474 files) | Scanned by `/api/status` |

**Total sourcevision data surface:** ~25.4 MB on disk
**Total loaded into browser on initial load:** ~25.9 MB (all 6 modules + prd.json)

---

## 2. CLI-Side Refresh Flow (`ndx refresh`)

### Pipeline Steps

```
ndx refresh
  │
  ├── 1. Pre-refresh: detect & stop running dashboard (SIGTERM → SIGKILL)
  ├── 2. Snapshot sourcevision files for rollback
  │      ⚠ Reads ALL 8 snapshot files into memory as Buffers
  │      ⚠ Peak: ~25 MB in Node.js process (dominated by callgraph.json)
  │
  ├── 3. sourcevision-analyze  (spawned child process)
  ├── 4. sourcevision-dashboard-artifacts  (writes metadata JSON)
  ├── 5. sourcevision-pr-markdown  (optional, spawned)
  ├── 6. web-build  (spawned child process)
  │
  ├── 7. Validate outputs (reads & JSON.parse each output file)
  │      ⚠ Only validates manifest.json and dashboard-artifacts.json (<2 KB)
  │
  └── 8. Signal live reload: POST /api/reload → 3 WebSocket broadcasts
```

### Memory Impact Assessment — CLI

| Operation | Peak memory | Duration | Notes |
|-----------|-------------|----------|-------|
| **Snapshot capture** | **~25 MB** | Instant | `readFileSync` on 8 files including 24 MB callgraph.json; held as Buffers for entire refresh duration |
| **Validation** | ~2 KB | Instant | Only reads manifest.json + dashboard-artifacts.json |
| **Rollback (on failure)** | ~25 MB | Instant | Writes Buffers back to disk, then GC |
| **Child processes** | Separate heap | Minutes | sourcevision-analyze runs in own process |

**Key finding:** The snapshot mechanism reads the entire 24 MB `callgraph.json` into
the CLI process memory and holds it for the full duration of the refresh (potentially
several minutes). This is the largest single allocation in the CLI-side flow. The
snapshot exists for rollback safety but could be replaced with a copy-on-disk strategy.

---

## 3. Server-Side Data Serving

### Data Routes (`routes-data.ts`)

The server uses **`createReadStream().pipe(res)`** for all data files — it does NOT
buffer entire files in server memory. This is the correct approach for the 24 MB
callgraph.json.

One exception: the `/api/status` endpoint.

### Status Endpoint (`routes-status.ts`)

```
GET /api/status  (polled every 10s by browser)
  ├── extractSvStatus: readFileSync("manifest.json")  ~2 KB
  ├── extractRexStatus: readFileSync("prd.json") + JSON.parse  ~828 KB
  │   └── computeStats + collectCompletedIds + findNextTask (tree traversal)
  └── extractHenchStatus: readdirSync + readFileSync on EVERY run file
      ⚠ 474 files × ~15 KB avg = reads ~6.9 MB of JSON per uncached call
```

**Cached with 5-second TTL** — limits the damage, but every cache miss triggers
a full scan of all 474 hench run files.

**Key finding:** `extractHenchStatus` is the most memory-intensive server-side
operation during refresh polling. It reads and parses every run file to count
active/stale runs. As the number of runs grows linearly, this becomes O(n) in
both I/O and memory.

---

## 4. Browser-Side Refresh Flow

### Initial Page Load (Two-Phase)

```
useAppData mount
  │
  ├── Phase 1 (blocking): loadModules(["manifest", "zones"])
  │   └── fetch /data/manifest.json (2 KB) + /data/zones.json (195 KB)
  │   └── Shell renders immediately
  │
  └── Phase 2 (deferred via requestIdleCallback):
      └── loadModules(["inventory", "imports", "components", "callGraph"])
          └── fetch 4 files in parallel
          ⚠ /data/callgraph.json = 24 MB parsed into JS objects
```

### After Initial Load — Polling & WebSocket

Three independent polling/event sources:

| Source | Interval | Data loaded | Memory per cycle |
|--------|----------|-------------|-----------------|
| **Data status polling** (`loader.ts`) | 5s | `GET /data/status` → mtimes only | ~200 bytes |
| **Project status polling** (`use-project-status.ts`) | 10s | `GET /api/status` → summary stats | ~1 KB |
| **Task usage polling** (`use-prd-data.ts`) | 10s | `GET /api/hench/task-usage` + `/api/token/utilization` | ~5–50 KB |

### WebSocket-Triggered Refresh (After `ndx refresh` or PRD changes)

```
POST /api/reload → server broadcasts 3 messages
  │
  Browser receives via WebSocket:
  ├── viewer:reload
  ├── sv:data-changed
  └── rex:prd-changed
  │
  Five-layer message pipeline:
  │
  ├── Layer 0: Response buffer gate
  │   └── Drops messages if tab hidden; flushes downstream on hide
  │
  ├── Layer 1: Message throttle (per-type debounce)
  │   └── rex:prd-changed: 300ms, rex:item-updated: 200ms
  │
  ├── Layer 2: Message coalescer (batch window)
  │   └── 150ms trailing-edge; max 50 messages per batch
  │
  ├── Layer 3: DOM update gate
  │   └── Queues state updates when tab hidden
  │
  └── Layer 4: Update batcher (RAF-based)
      └── Single setData call per animation frame

On coalescer flush:
  ├── fetchPRDData()  → GET /data/prd.json (828 KB) + diffDocument()
  └── fetchTaskUsage() → GET /api/hench/task-usage + /api/token/utilization
```

### Selective Module Reload (After mtime change detected)

When the 5-second data poller detects a file mtime change, it only reloads the
changed modules (not all 6). This is efficient — unless `ndx refresh` just ran,
in which case ALL mtimes change and ALL modules reload simultaneously.

**Peak browser memory during full refresh:**

| Data | Parsed size (approx) | Notes |
|------|---------------------|-------|
| `callgraph.json` | ~50–80 MB as JS objects | 24 MB JSON expands ~2–3× when parsed |
| `prd.json` | ~2–3 MB as JS objects | 828 KB JSON, tree of nested objects |
| `imports.json` | ~1.5 MB as JS objects | Edge list with file paths |
| `inventory.json` | ~800 KB as JS objects | File metadata records |
| `zones.json` | ~500 KB as JS objects | Zone definitions |
| `components.json` | ~60 KB as JS objects | Small |
| `manifest.json` | ~5 KB as JS objects | Tiny |
| **Subtotal** | **~55–85 MB** | Depends on string interning |

Plus: `diffDocument()` temporarily holds both old and new PRD trees during
structural comparison (~4–6 MB transient).

---

## 5. Memory Protection Mechanisms (Already Implemented)

### Memory Monitor (`memory-monitor.ts`)

- Polls `performance.memory` every 5 seconds (Chrome/Edge only)
- Classifies memory level: normal (<50%), elevated (50–70%), warning (70–85%), critical (>85%)
- Falls back to `"normal"` on browsers without `performance.memory`

### Graceful Degradation (`graceful-degradation.ts`)

| Level | Disabled features |
|-------|-------------------|
| **normal** | None |
| **elevated** | `autoRefresh`, `deferredLoading` |
| **warning** | + `animations` |
| **critical** | + `detailPanel` (minimal UI) |

### Refresh Throttle (`refresh-throttle.ts`)

| Level | Concurrency | Interval multiplier |
|-------|-------------|-------------------|
| normal | 3 parallel | 1× |
| elevated | 2 parallel | 2× |
| warning | 1 serial | 4× |
| critical | 0 (paused) | ∞ |

### Response Buffer Gate (`response-buffer-gate.ts`)

- Drops WebSocket messages when tab is hidden
- Flushes all downstream buffers on tab hide (releases memory)
- Triggers single reconciliation fetch on resume (not N replays)

---

## 6. Identified Risks and Bottlenecks

### Risk 1: callgraph.json — 24 MB on disk, ~50–80 MB as JS objects ⚡ CRITICAL

The call graph is the single largest data file by an order of magnitude. When
parsed into JavaScript objects in the browser, it expands to 50–80 MB due to
string pointers, object headers, and V8 overhead.

**Where it loads:**
- Browser: deferred phase of initial load; selective reload on mtime change
- CLI: snapshot capture in `ndx refresh` (held in memory for entire refresh)

**Impact:** On a machine with a 4 GB Chrome heap limit, this single file
consumes 1.2–2% of the limit. Combined with other data and the React/Preact
component tree, baseline usage may reach 150–200 MB before any user
interaction.

### Risk 2: Hench run file scanning — 474 files, 6.9 MB total ⚡ HIGH

`extractHenchStatus()` reads and JSON.parse's every run file on each uncached
`/api/status` request. With 474 files and growing, this is:
- **O(n) I/O** — 474 synchronous `readFileSync` calls
- **O(n) memory** — 6.9 MB of JSON buffers + parsed objects simultaneously in server memory
- **O(n) CPU** — 474 `JSON.parse` calls per cache miss

The 5-second cache TTL mitigates frequency but not peak impact.

### Risk 3: Post-`ndx refresh` thundering herd ⚡ MEDIUM

When `ndx refresh` completes and signals `/api/reload`, the server broadcasts
three WebSocket messages simultaneously. The browser's coalescer batches them
into one flush, but that flush triggers:
1. `fetchPRDData()` — full 828 KB prd.json fetch + parse + diff
2. `fetchTaskUsage()` — two API calls
3. Selective module reload via the 5s data poller (detects all mtimes changed)
4. All 6 sourcevision modules reload in parallel

The concurrent fetch of all modules + PRD + task usage creates a transient
memory spike where both old and new data coexist during the diff/replace cycle.

### Risk 4: CLI snapshot holds ~25 MB for full refresh duration ⚡ LOW

`snapshotRefreshState()` reads all 8 sourcevision files (including the 24 MB
callgraph.json) into Node.js Buffers. These are held in memory for the entire
refresh duration (potentially minutes during sourcevision-analyze). The snapshot
is only used on failure (rollback), so in the happy path the 25 MB sits idle.

---

## 7. Refresh Orchestration Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ndx refresh (CLI)                          │
│                                                                    │
│  ┌──────────────┐   ┌───────────────┐   ┌─────────────────────┐   │
│  │  Stop running │   │  Snapshot SV  │   │   Run pipeline:     │   │
│  │  dashboard    │──▶│  files (~25MB)│──▶│   analyze → build   │   │
│  └──────────────┘   └───────────────┘   └─────────┬───────────┘   │
│                                                    │               │
│                                          ┌─────────▼───────────┐   │
│                                          │  Validate outputs   │   │
│                                          │  Signal live reload │   │
│                                          └─────────┬───────────┘   │
└────────────────────────────────────────────────────┼───────────────┘
                                                     │
                                   POST /api/reload  │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Web Server (Node.js)                        │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │  Broadcast 3 WebSocket messages:                        │       │
│  │    viewer:reload, sv:data-changed, rex:prd-changed      │       │
│  └───────────────────────┬─────────────────────────────────┘       │
│                          │                                         │
│  Endpoints hit during refresh:                                     │
│  ┌────────────────────────────────┐  ┌──────────────────────────┐  │
│  │ GET /data/<file>               │  │ GET /api/status           │  │
│  │ Streams files via ReadStream   │  │ Reads prd.json (828K)    │  │
│  │ ✅ No server-side buffering    │  │ Scans 474 run files (7MB)│  │
│  └────────────────────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Preact)                           │
│                                                                    │
│  WebSocket → Buffer Gate → Throttle → Coalescer → DOM Gate → RAF  │
│                                                                    │
│  ┌──────────────────────────┐   ┌────────────────────────────────┐ │
│  │ On coalescer flush:      │   │ On data poller (5s):           │ │
│  │  fetchPRDData (828KB)    │   │  GET /data/status (mtimes)     │ │
│  │  fetchTaskUsage (2 calls)│   │  If changed: reload modules    │ │
│  └──────────────────────────┘   │  ⚠ All 6 after ndx refresh    │ │
│                                 │  ⚠ callgraph.json = 24MB      │ │
│                                 └────────────────────────────────┘ │
│                                                                    │
│  Memory protection:                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ memory-monitor → graceful-degradation → refresh-throttle    │   │
│  │ Thresholds: 50% elevated, 70% warning, 85% critical        │   │
│  │ Actions: pause polling, disable graph, reduce to minimal UI │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Summary

| Category | Component | Memory footprint | Frequency | Risk |
|----------|-----------|-----------------|-----------|------|
| CLI | Snapshot capture | ~25 MB (Buffers) | Per refresh | Low |
| CLI | Child processes (analyze) | Separate heap | Per refresh | None |
| Server | Data file streaming | O(1) via ReadStream | Per request | None |
| Server | `/api/status` (hench scan) | ~7 MB (474 run files) | Every 5s (cached) | High |
| Server | `/api/status` (PRD parse) | ~828 KB | Every 5s (cached) | Low |
| Browser | callgraph.json parse | ~50–80 MB JS objects | Initial + refresh | **Critical** |
| Browser | prd.json parse + diff | ~4–6 MB transient | Every PRD change | Medium |
| Browser | All modules post-refresh | ~55–85 MB total | After ndx refresh | High |
| Browser | WebSocket message pipeline | <1 KB per message | Continuous | None |

The **callgraph.json** (24 MB on disk → 50–80 MB in browser) is the dominant
memory consumer by far. The existing graceful degradation system can pause
polling at elevated memory levels, but it cannot prevent the initial load of
callgraph.json or reduce its retained size once loaded.
