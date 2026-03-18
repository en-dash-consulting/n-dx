# Memory Management: Risks and Flaws

Known risks, design flaws, race conditions, and areas of concern in the memory management subsystem. Items are categorized by severity and likelihood.

---

## Critical Issues

### 1. macOS Memory Reporting Underestimates Availability

**Location:** `packages/hench/src/process/memory-monitor.ts`
**Risk:** Premature throttling / unnecessary execution delays on macOS

On macOS, `os.freemem()` returns only vm_stat "Free" pages, ignoring Inactive and compressed pages that are immediately reclaimable. A Mac with 32 GB RAM and 10 GB of reclaimable Inactive pages will report ~70% usage when actual pressure is much lower.

**Impact:** The 80% delay threshold and 90% spawn threshold will trigger significantly earlier than intended on macOS. Developers on macOS will experience unnecessary throttling during normal operation.

**Affected configurations:** All macOS users with default thresholds.

### 2. Container Memory Limits Are Invisible

**Location:** `packages/hench/src/process/memory-monitor.ts`
**Risk:** OOM kills inside containers despite passing throttle checks

When running inside Docker or Kubernetes, `/proc/meminfo` on Linux reflects the **host** machine's memory, not the container's cgroup limit. A container with a 2 GB limit on a 64 GB host will never trigger the throttle (host appears 97% free) but will be OOM-killed at its 2 GB cgroup boundary.

**Impact:** Complete bypass of all memory safety mechanisms in containerized environments. The throttle, monitor, and all derived decisions operate on incorrect data.

**Affected configurations:** Any containerized deployment (Docker, Kubernetes, ECS, etc.).

### 3. Synchronous gzip in Run Archiver Blocks the Event Loop

**Location:** `packages/hench/src/store/run-archiver.ts` (uses `gzipSync()`)
**Risk:** Event loop starvation during archival of large or many run files

`gzipSync()` is a synchronous operation that blocks the Node.js event loop for the entire duration of compression. Run files can be several megabytes (especially with detailed tool-use transcripts). Compressing multiple files sequentially during a single archival cycle can block the event loop for seconds.

**Impact:** During archival, the web server cannot handle incoming requests, WebSocket messages are delayed, and the dashboard may appear unresponsive. Timer-based schedulers (retention, cleanup) may drift.

**Affected scenarios:** Archival cycles with many eligible files (e.g., first run after lowering `maxAgeDays`).

---

## High Severity

### 4. Race Conditions in File Lifecycle Operations

**Location:** `run-archiver.ts`, `run-retention.ts`
**Risk:** File not found errors, double-processing

Both the archiver and retention system follow a pattern of `readdir()` -> `stat()` -> operate. Between any of these steps, external processes (or the other scheduler) could modify or delete the file.

**Specific scenarios:**
- Archiver identifies a `.json` file. Before it compresses, the retention scheduler deletes it.
- Retention identifies a `.json.gz` file. Before it extracts stats, the archiver re-processes the same directory.
- A concurrent `hench run` writes a new run file while `readdir()` is in progress.

**Mitigation in place:** Try-catch wrappers around individual file operations. Errors are recorded in result objects but don't abort the cycle.

**Residual risk:** Stats extraction from a deleted file would fail silently, meaning token usage data for that run is lost forever if `preserveUsageStats` is enabled.

### 5. Browser Memory API Unavailable Outside Chromium

**Location:** `packages/web/src/viewer/memory-monitor.ts`
**Risk:** No memory protection on Firefox/Safari

`performance.memory` is a non-standard Chromium-only API. On Firefox, Safari, and other browsers:
- All heap sizes are -1
- Level is always classified as `"normal"` (negative ratios return normal)
- Graceful degradation never triggers
- No memory warnings are shown

**Impact:** Users on Firefox or Safari have zero protection against OOM crashes. The dashboard will consume memory without limit until the browser tab crashes.

### 6. Error Swallowing in Polling State Manager

**Location:** `packages/web/src/viewer/polling-state.ts`
**Risk:** Silent failures in suspend/resume/dispose operations

All callback invocations in the polling state manager are wrapped in try-catch with empty catch blocks. If a polling source's `suspend()` or `resume()` callback throws, the error is silently discarded.

**Specific concerns:**
- A source that fails to suspend continues consuming memory during pressure
- A source that fails to resume stays stuck in suspended state after recovery
- No logging or diagnostic information is available to identify the failing source

### 7. Listener Callback Errors Propagate Unhandled

**Location:** `memory-monitor.ts` (viewer), `graceful-degradation.ts`
**Risk:** One bad listener can break the entire notification chain

`onSnapshot()` and `onDegradationChange()` iterate over listener arrays and call each one. If a listener throws, the exception propagates and subsequent listeners in the array are never called.

**Impact:** A single misbehaving component subscription can prevent the degradation system from notifying other components, leading to partial feature disabling and inconsistent UI state.

---

## Medium Severity

### 8. Retention and Archival Config Overlap

**Risk:** Confusing or conflicting behavior when both systems process the same file

A run file's lifecycle: created -> (30 days) -> compressed by archiver -> (180 days) -> deleted by retention. The two systems operate independently with separate config sections.

**Potential confusion:**
- If `archival.maxAgeDays` is set higher than `retention.maxAgeDays`, files could be deleted before being compressed
- If archival is disabled but retention is enabled, uncompressed files accumulate for 180 days, consuming more disk space than expected
- There is no validation that `archival.maxAgeDays < retention.maxAgeDays`

### 9. Token Usage Stats Extraction Accuracy

**Location:** `packages/hench/src/store/run-retention.ts`
**Risk:** Incomplete or inaccurate preserved statistics

When extracting token usage before deletion, the system reads `tokenUsage` fields from run files. If the run file schema changes (field names, nesting structure), the extraction silently produces zeros for missing fields.

**Specific concerns:**
- No schema validation on run file contents before extraction
- Fields accessed by string key without type checking
- Cache token fields (`cacheCreationInput`, `cacheReadInput`) are optional and may be absent in older files
- Aggregation of "turns" counts depends on array structure that may vary

### 10. Linear Regression Leak Detection False Positives

**Location:** `packages/hench/src/process/process-memory-tracker.ts`
**Risk:** Legitimate memory growth patterns flagged as leaks

The leak detector uses a simple linear regression model. Any process with steadily increasing RSS will be flagged, including:
- Processes building large data structures that are expected to grow (e.g., analyzing a large codebase)
- Processes with legitimate phased memory growth (load data -> process -> output) where the "load" phase looks linear
- JIT compilation warmup causing initial RSS growth

**Minimum sample requirement (6)** at 5-second intervals means a leak can be detected as early as 30 seconds into execution. Short-lived spikes or loading phases could trigger false "moderate" leak alerts.

### 11. No Backpressure on WebSocket Broadcasts

**Risk:** Memory pressure from broadcast serialization

When the server broadcasts memory stats, leak alerts, and cleanup events to all connected WebSocket clients, it serializes the payload once per broadcast. If many clients are connected and the payload is large (e.g., detailed leak reports with projected RSS), the serialization and socket write buffers can themselves contribute to memory pressure.

The dead-connection pruning improvement helps, but there's no limit on the number of active connections or backpressure mechanism for slow consumers.

### 12. Daily Retention Scheduler Drift

**Location:** `packages/hench/src/store/run-retention-scheduler.ts`
**Risk:** Scheduler accumulates drift over long uptimes

The retention scheduler uses `setInterval()` with a 24-hour period. Node.js `setInterval` is not guaranteed to fire at exact intervals -- drift accumulates over time. After weeks of uptime, the scheduler could drift by minutes or hours.

**Impact:** Low. Retention is a background housekeeping task where hour-level precision is sufficient. However, if two schedulers (retention + cleanup) drift into overlapping execution windows, they could contend on filesystem operations.

---

## Low Severity

### 13. Hardcoded 2 GB Fallback Heap Limit

**Location:** `packages/web/src/viewer/memory-monitor.ts`
**Risk:** Inaccurate level classification on non-Chromium browsers

The fallback `FALLBACK_HEAP_LIMIT = 2 * 1024 * 1024 * 1024` is used when `performance.memory` is unavailable. Since all heap sizes are -1 in this case, the usage ratio is always negative, which classifies as `"normal"`. The fallback limit is never actually used for classification -- it exists as a safety net but doesn't serve a practical purpose in the current code path.

### 14. Retention Warning System Is Passive

**Location:** `packages/hench/src/store/run-retention.ts`
**Risk:** Users may not notice approaching deletions

The warning window identifies files between 150-180 days old, but the warning is only available programmatically through the `RetentionResult.warningFiles` array. There is no proactive user notification (no CLI warning, no email, no dashboard alert).

**Impact:** Users relying on run history data may lose files without realizing the retention policy is about to delete them.

### 15. Process Memory Tracker Ring Buffer Eviction

**Location:** `packages/hench/src/process/process-memory-tracker.ts`
**Risk:** Early samples lost for long-running processes

The ring buffer evicts oldest samples when `maxSamples` (360) is reached. At 5-second sampling intervals, this covers 30 minutes. For processes running longer than 30 minutes, early memory behavior is lost, which means:
- The linear regression only analyzes the most recent 30 minutes
- A slow leak that manifests over hours may not be detected if it flattens within any 30-minute window
- Peak RSS tracking is maintained separately and is not affected

---

## Deferred Tasks

Four tasks from the memory epics were deferred and remain unimplemented:

| Task | Epic | Why It Matters |
|------|------|---------------|
| Analyze refresh task orchestration | Web UI Memory | Root cause analysis of which refresh tasks consume the most memory was never completed |
| Suspend execution panel polling during memory pressure | Polling Loop Management | The execution panel's 3-second polling continues during memory pressure |
| Implement polling restart when memory pressure subsides | Polling Loop Management | Automatic recovery after pressure subsides is incomplete |
| Implement immediate data synchronization on activation | Tab Visibility | Tab activation doesn't trigger an immediate full refresh, potentially showing stale data |

The execution panel polling gap (3-second interval continues under pressure) is the most impactful deferred item, as it's one of the highest-frequency polling sources.

---

## Summary by Severity

| Severity | Count | Key Themes |
|----------|-------|------------|
| Critical | 3 | Platform accuracy, container blindness, event loop blocking |
| High | 4 | Browser compatibility, silent error swallowing, listener propagation |
| Medium | 5 | Config overlap, schema fragility, false positives, broadcast pressure |
| Low | 3 | Fallback constants, passive warnings, ring buffer limits |
