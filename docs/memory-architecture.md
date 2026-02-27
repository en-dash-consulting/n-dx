# Memory Management Architecture

Comprehensive overview of the memory management subsystem introduced across the n-dx monorepo. This work spans six epics, 10 features, and 24 tasks covering server-side throttling, client-side degradation, process lifecycle management, and data retention.

## System Overview

The memory management system operates across three tiers of the architecture:

```
  +--------------------------+
  |     Web Dashboard        |   Client-side: browser heap monitoring,
  |  (viewer / Preact UI)    |   graceful degradation, polling suspension
  +--------------------------+
              |
  +--------------------------+
  |     Web Server           |   Server-side: usage cleanup scheduler,
  |  (Express + WebSocket)   |   process memory API routes, broadcasts
  +--------------------------+
              |
  +--------------------------+
  |     Hench Agent          |   Execution-side: memory throttle, system
  |  (process management)    |   memory monitor, per-process tracking,
  |                          |   run archival, retention policies
  +--------------------------+
```

Each tier handles a distinct concern but they communicate via WebSocket broadcasts and shared configuration in `.n-dx.json`.

---

## Execution-Side Memory Management (hench)

### System Memory Monitor

**Module:** `packages/hench/src/process/memory-monitor.ts`

Provides cross-platform system memory readings and pre-spawn gating. Before any child process is spawned, the monitor checks whether the system has enough available memory.

**How it works:**
1. Reads available memory using platform-specific methods (see [OS Behavior](./memory-os-behavior.md))
2. Computes usage percentage: `(total - available) / total * 100`
3. Compares against `spawnThreshold` (default: 90%)
4. Returns a `SpawnMemoryCheck` with `allowed: boolean` and a reason string if blocked

**Configuration:**
```typescript
interface MemoryMonitorConfig {
  enabled: boolean;        // default: true
  spawnThreshold: number;  // default: 90 (percentage)
}
```

The monitor implements `SystemMemoryReader`, making it injectable for testing with deterministic values.

### Memory Throttle

**Module:** `packages/hench/src/process/memory-throttle.ts`

Entry-gate decision engine with a two-tier threshold system that decides whether new task executions should proceed, delay, or be rejected.

**Decision logic:**
```
usage >= 95%  -->  REJECT  (throw MemoryThrottleRejectError)
usage >= 80%  -->  DELAY   (exponential backoff, retry up to 10 times)
usage <  80%  -->  ALLOW   (proceed immediately)
```

**Exponential backoff:**
- Base delay: 2 seconds
- Formula: `min(baseDelay * 2^attempt, maxDelay)`
- Max delay: 30 seconds (capped)
- Max retries: 10
- Accepts an `onThrottle` callback for progress reporting during delays

**Configuration:**
```typescript
interface MemoryThrottleConfig {
  enabled: boolean;         // default: true
  delayThreshold: number;   // default: 80 (percentage)
  rejectThreshold: number;  // default: 95 (percentage)
  baseDelayMs: number;      // default: 2000
  maxDelayMs: number;       // default: 30000
  maxRetries: number;       // default: 10
}
```

**Distinction from SystemMemoryMonitor:** The monitor performs a single pass/fail check before each process spawn. The throttle is the broader entry-gate for entire task executions, implementing retry loops with backoff.

### Per-Process Memory Tracker

**Module:** `packages/hench/src/process/process-memory-tracker.ts`

Monitors individual task processes over their lifetime, collecting RSS samples and performing linear regression to detect memory leaks.

**Data collection:**
- Maintains per-process ring buffers (max 360 samples)
- Records `rssBytes` with timestamps at regular intervals
- Tracks active and completed processes (up to 20 completed histories retained)

**Leak detection via linear regression:**
- Uses ordinary least squares (OLS): `y = a + bx` where x = elapsed seconds, y = RSS bytes
- Computes slope (bytes/sec) and R-squared (goodness of fit)
- A leak is flagged when:
  - Slope > 100 KB/s (configurable)
  - R-squared >= 0.7 (strong linear trend)
- Requires minimum 6 samples before analysis runs

**Severity classification:**
- **Moderate:** slope > 100 KB/s and R-squared >= 0.7
- **Severe:** slope > 1 MB/s or R-squared > 0.9
- Projects RSS at +1 hour if leak trend continues

**Health assessment:**
- `"healthy"` if no leaks detected
- `"warning"` if any moderate leaks
- `"critical"` if any severe leaks

**Configuration:**
```typescript
interface ProcessMemoryTrackerConfig {
  maxSamples: number;                   // default: 360
  minSamplesForLeakDetection: number;   // default: 6
  leakSlopeThreshold: number;           // default: 102400 (100 KB/s)
  leakRSquaredThreshold: number;        // default: 0.7
  maxCompletedHistories: number;        // default: 20
}
```

### Run File Archival

**Module:** `packages/hench/src/store/run-archiver.ts`

Compresses old hench run files (`.json` to `.json.gz`) using Node.js built-in `zlib.gzipSync()` to reduce filesystem footprint.

**Process:**
1. Scans `.hench/runs/` for `.json` files older than `maxAgeDays`
2. Compresses each file with gzip
3. Writes `.json.gz` file, then deletes the original `.json`
4. All downstream consumers (`runs.ts`, aggregators) handle both formats transparently

**Configuration:**
```typescript
interface ArchivalConfig {
  maxAgeDays: number;  // default: 30
  enabled: boolean;    // default: true
}
```

Zero external dependencies -- uses only Node.js built-in `zlib`.

### Run History Retention

**Module:** `packages/hench/src/store/run-retention.ts`
**Scheduler:** `packages/hench/src/store/run-retention-scheduler.ts`

Enforces retention policies by deleting very old run files while preserving aggregated token usage statistics in a JSONL audit log.

**Lifecycle:**
1. Identifies files older than `maxAgeDays` (default: 180 days / 6 months)
2. Identifies files in the warning window (150-180 days, notifying users of approaching deletion)
3. Extracts token usage stats from eligible files before deletion
4. Writes aggregated stats to `.hench/retention-stats.jsonl`
5. Deletes eligible files (both `.json` and `.json.gz`)

**Warning system:** Files within `warningDays` of the deletion threshold are flagged but not yet deleted, giving users a window to extract data.

**Scheduler:** Runs daily (24-hour interval) via `setInterval` with `unref()` so it does not prevent process exit.

**Configuration:**
```typescript
interface RetentionConfig {
  maxAgeDays: number;           // default: 180
  enabled: boolean;             // default: true
  warningDays: number;          // default: 30
  preserveUsageStats: boolean;  // default: true
  intervalMs?: number;          // scheduler interval
}
```

---

## Server-Side Memory Management (web)

### Usage Cleanup Scheduler

**Module:** `packages/web/src/server/usage-cleanup-scheduler.ts`

Periodically cross-references in-memory usage aggregation with the PRD to identify and prune entries for tasks that no longer exist.

**Key design principle:** Only in-memory aggregation state is pruned. Run files on disk are never modified or deleted. Data is always recoverable via `aggregator.reset()`.

**Process:**
1. Get aggregated task usage from the token usage aggregator
2. Load valid task IDs from `.rex/prd.json`
3. Identify orphaned entries (usage data for tasks not in PRD)
4. Prune orphaned entries from in-memory aggregation
5. Write audit log to `.hench/usage-cleanup.jsonl`
6. Broadcast cleanup event via WebSocket

**Graceful degradation:** If the PRD is unavailable or corrupt, the cleanup cycle is skipped entirely. No data is ever removed without a valid PRD to cross-reference against.

**Scheduler:** Weekly (7-day interval), timer is `unref()`'d.

---

## Client-Side Memory Management (viewer)

### Browser Memory Monitor

**Module:** `packages/web/src/viewer/memory-monitor.ts`

Tracks browser JS heap memory in real-time using `performance.memory` (Chromium) with fallback heuristics for other browsers.

**Memory levels:**
| Level | Threshold | Meaning |
|-------|-----------|---------|
| `normal` | < 50% | All systems nominal |
| `elevated` | >= 50% | Early warning |
| `warning` | >= 70% | Significant pressure |
| `critical` | >= 85% | Approaching crash |

**Polling:** 5-second intervals. Maintains a history of 60 snapshots for debugging. Registers with the polling state manager as an **essential** source so it continues running even during memory pressure (needed to detect recovery).

### Graceful Degradation

**Module:** `packages/web/src/viewer/graceful-degradation.ts`

Progressively disables UI features based on memory tier. Features are re-enabled when pressure subsides.

**Degradation tiers (cumulative):**
| Memory Level | Features Disabled |
|---|---|
| `normal` | None |
| `elevated` | `autoRefresh`, `deferredLoading` |
| `warning` | + `graphRendering`, `animations` |
| `critical` | + `detailPanel` (minimal UI only) |

Components check feature availability via `isFeatureDisabled(feature)` before rendering expensive content.

### Centralized Polling State

**Module:** `packages/web/src/viewer/polling-state.ts`

Registry of all polling sources in the UI. Coordinates suspension and resumption during memory pressure.

**Concepts:**
- **Essential sources:** Continue running during pressure (e.g., the memory monitor itself)
- **Non-essential sources:** Suspended during pressure (data fetchers, status indicators)
- **Generation counter:** Increments on suspend/resume cycles, allowing async code to detect stale state

**Registered polling sources:**
- Memory monitor (essential)
- Data loader (5s interval)
- Execution panel (3s interval)
- Status indicator (10s interval)
- Usage indicator polling

### Polling Suspension Indicator

**Component:** `packages/web/src/viewer/components/polling-suspension-indicator.ts`

Floating UI element that appears when polling is suspended due to memory pressure. Shows the count of suspended data sources and provides a manual refresh button.

---

## WebSocket Connection Lifecycle

Dead WebSocket connections are detected within 1 second (vs. the previous 30-second ping/pong window). Disconnected clients are immediately pruned from the broadcast set, eliminating wasted serialization and write operations to dead connections.

---

## Configuration

All memory and lifecycle settings are centralized in `.n-dx.json`:

```json
{
  "guard": {
    "memoryThrottle": {
      "enabled": true,
      "delayThreshold": 80,
      "rejectThreshold": 95,
      "baseDelayMs": 2000,
      "maxDelayMs": 30000,
      "maxRetries": 10
    },
    "memoryMonitor": {
      "enabled": true,
      "spawnThreshold": 90
    }
  },
  "archival": {
    "enabled": true,
    "maxAgeDays": 30
  },
  "retention": {
    "enabled": true,
    "maxAgeDays": 180,
    "warningDays": 30,
    "preserveUsageStats": true,
    "intervalMs": 86400000
  },
  "cleanup": {
    "intervalMs": 604800000
  }
}
```

All values have safe defaults. Missing or malformed configuration falls back gracefully without errors.

---

## Data Flow

### Task Execution Flow

```
User triggers "ndx work"
       |
       v
  MemoryThrottle.gate()
  - Reads system memory
  - Decision: allow / delay (backoff) / reject (throw)
       |
       v
  SystemMemoryMonitor.checkBeforeSpawn()
  - Pre-spawn gate per child process
       |
       v
  Process executes
  - ProcessMemoryTracker records RSS samples
  - Leak detection runs on collected data
       |
       v
  Run completes --> .hench/runs/{id}.json
       |
       v  (after 30 days)
  RunArchiver compresses --> .json.gz
       |
       v  (after 180 days)
  RunRetention deletes --> stats preserved in retention-stats.jsonl
```

### Browser Memory Flow

```
Page loads
       |
       v
  MemoryMonitor starts (5s polling)
       |
       v
  Snapshot taken --> level classified
       |
       v
  GracefulDegradation evaluates tier
  - Disables features based on tier
       |
       v
  PollingState suspends non-essential sources
       |
       v
  PollingSuspensionIndicator shows in UI
       |
       v  (memory recovers)
  PollingState resumes all sources
  GracefulDegradation re-enables features
```

---

## Module Index

| Module | Package | Purpose |
|--------|---------|---------|
| `memory-monitor.ts` | hench | System memory readings + pre-spawn gate |
| `memory-throttle.ts` | hench | Execution entry-gate with delay/reject |
| `process-memory-tracker.ts` | hench | Per-process leak detection via regression |
| `run-archiver.ts` | hench | Compress old runs (.json to .gz) |
| `run-retention.ts` | hench | Delete very old runs, preserve stats |
| `run-retention-scheduler.ts` | hench | Periodic retention enforcement (daily) |
| `usage-cleanup-scheduler.ts` | web | Prune orphaned aggregation entries (weekly) |
| `memory-monitor.ts` | web/viewer | Browser JS heap monitoring |
| `graceful-degradation.ts` | web/viewer | Progressive feature disabling |
| `polling-state.ts` | web/viewer | Centralized polling source registry |
| `polling-suspension-indicator.ts` | web/viewer | UI indicator for suspended polling |
| `memory-warning.ts` | web/viewer | Warning banner component |
