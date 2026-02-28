# Memory Management: Areas of Improvement

Prioritized improvements to the memory management subsystem, organized by impact and effort. Each item references the specific risk or gap it addresses from the [Risks and Flaws](./memory-risks-and-flaws.md) document.

---

## High Impact, Moderate Effort

### 1. macOS Memory Pressure Detection via `vm_stat`

**Addresses:** [Risk #1] macOS memory reporting underestimates availability

Replace `os.freemem()` on macOS with a parsed output of the `vm_stat` command or `sysctl` values that include inactive and purgeable pages.

**Approach:**
```
Available = Free Pages + Inactive Pages + Purgeable Pages
```

Spawn `vm_stat` as a child process (infrequent -- only when `snapshot()` is called) and parse the output. Alternatively, use `sysctl hw.memsize` for total and compute available from the `vm_stat` page counts.

**Trade-offs:**
- Adds a child process spawn per snapshot (but snapshots are infrequent -- pre-spawn checks only)
- `vm_stat` output format could change across macOS versions (mitigated with fallback to `os.freemem()`)
- More accurate readings mean thresholds that are actually meaningful on macOS

**Expected outcome:** Throttle triggers at 80% of true available memory instead of 80% of a misleadingly low "free" number. Eliminates the majority of false throttle activations on macOS.

### 2. Container-Aware Memory Monitoring

**Addresses:** [Risk #2] Container memory limits are invisible

Detect container environments and read cgroup memory limits instead of (or in addition to) `/proc/meminfo`.

**Detection heuristic:**
1. Check for `/.dockerenv` file existence
2. Check for `container` in `/proc/1/cgroup`
3. Read `/sys/fs/cgroup/memory.max` (cgroups v2) or `/sys/fs/cgroup/memory/memory.limit_in_bytes` (cgroups v1)

**Implementation:**
```
if (running in container):
  total = min(cgroup_limit, os.totalmem())
  available = cgroup_limit - current_cgroup_usage
else:
  (existing /proc/meminfo logic)
```

For cgroup usage, read `/sys/fs/cgroup/memory.current` (v2) or `/sys/fs/cgroup/memory/memory.usage_in_bytes` (v1).

**Expected outcome:** Memory throttle works correctly in Docker, Kubernetes, and other container runtimes. Prevents OOM kills that currently bypass all safety mechanisms.

### 3. Async Compression in Run Archiver

**Addresses:** [Risk #3] Synchronous gzip blocks the event loop

Replace `gzipSync()` with the streaming `zlib.createGzip()` API or the promise-based `zlib.gzip()` wrapper.

**Approach:**
```typescript
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

async function compressRunFile(runsDir: string, filename: string) {
  const data = await readFile(join(runsDir, filename));
  const compressed = await gzipAsync(data);
  await writeFile(join(runsDir, filename + '.gz'), compressed);
  await unlink(join(runsDir, filename));
}
```

For very large files, use `pipeline()` with `createGzip()` for streaming compression that doesn't buffer the entire file in memory.

**Expected outcome:** Archival cycles no longer block the event loop. Web server remains responsive during compression of multiple files.

### 4. Complete the Deferred Polling Suspension Tasks

**Addresses:** [Risk: Deferred Tasks] Incomplete memory pressure response

Three deferred tasks leave gaps in the polling suspension system:

**a) Suspend execution panel polling (3s interval):**
The execution panel is the highest-frequency non-essential polling source. Not suspending it during memory pressure means 20 requests/minute continue when the system is trying to recover.

**b) Implement polling restart on pressure recovery:**
Without automatic restart, suspended polling sources stay suspended indefinitely until a page refresh. Users see stale data with no indication that fresh data is available.

**c) Immediate data sync on tab activation:**
When a background tab becomes active, it should trigger a single immediate refresh before resuming periodic polling. Currently, the user waits up to one full polling interval (5-10 seconds) before seeing updated data.

---

## High Impact, Low Effort

### 5. Wrap Listener Callbacks in Try-Catch

**Addresses:** [Risk #7] Listener callback errors propagate unhandled

In `memory-monitor.ts` (viewer) and `graceful-degradation.ts`, wrap each listener invocation in a try-catch to prevent one bad listener from breaking the notification chain:

```typescript
for (const listener of listeners) {
  try {
    listener(snapshot);
  } catch (err) {
    console.error('[memory-monitor] listener error:', err);
  }
}
```

This is a minimal change (a few lines per notification loop) with disproportionate reliability benefit.

### 6. Validate Archival/Retention Config Consistency

**Addresses:** [Risk #8] Config overlap between archival and retention

During config loading, validate that `archival.maxAgeDays < retention.maxAgeDays` and warn if the relationship is inverted:

```typescript
if (archivalConfig.maxAgeDays >= retentionConfig.maxAgeDays) {
  console.warn(
    `[config] archival.maxAgeDays (${archivalConfig.maxAgeDays}) >= retention.maxAgeDays (${retentionConfig.maxAgeDays}). ` +
    `Files may be deleted before being compressed.`
  );
}
```

### 7. Log Errors in Polling State Manager

**Addresses:** [Risk #6] Silent error swallowing in polling-state.ts

Replace empty catch blocks with `console.warn` calls that identify the failing source:

```typescript
try {
  source.callbacks.suspend();
} catch (err) {
  console.warn(`[polling-state] failed to suspend source "${key}":`, err);
}
```

This preserves the non-fatal behavior while making failures diagnosable.

---

## Medium Impact, Moderate Effort

### 8. Multi-Strategy Leak Detection

**Addresses:** [Risk #10] Linear regression false positives

Supplement the linear regression model with additional heuristics to reduce false positives:

**a) Phase detection:** Divide the sample window into thirds. If the first third shows growth but the last third shows plateau, it's likely a loading phase, not a leak.

**b) Magnitude gating:** Only flag leaks where the projected +1h RSS exceeds a meaningful threshold (e.g., 500 MB or 25% of system RAM). A 100 KB/s leak in a process using 50 MB is less concerning than the same rate in a process using 2 GB.

**c) Sawtooth detection:** GC-heavy workloads show a sawtooth pattern (grow -> drop -> grow -> drop). Detect this by looking for significant RSS drops in the sample history. If drops > 20% of peak occur, reduce leak confidence.

### 9. Proactive Retention Warnings

**Addresses:** [Risk #14] Passive warning system

Surface retention warnings to users through multiple channels:

- **CLI:** `hench status` could include a warning line like `3 runs approaching retention deletion (150+ days old)`
- **Dashboard:** Show a notification badge on the runs panel when warning files exist
- **WebSocket:** Broadcast `hench:retention-warning` events during scheduler cycles

### 10. Adaptive Browser Memory Thresholds

**Addresses:** [Risk #5, #13] No protection on non-Chromium browsers

Instead of a hardcoded 2 GB fallback, attempt to estimate available heap through allocation probing:

1. Allocate progressively larger ArrayBuffers until allocation fails
2. Use the failure point as an estimate of available heap
3. Cache the result (only probe once per session)

This is aggressive and may cause GC pressure. A lighter alternative: use `navigator.deviceMemory` (available in Chrome and some other browsers) as a rough upper bound for the heap limit.

### 11. File Locking for Archival/Retention Coordination

**Addresses:** [Risk #4] Race conditions in file lifecycle operations

Use advisory file locks (or a simple lockfile mechanism) to prevent the archiver and retention scheduler from operating on the same directory simultaneously:

```typescript
const lockPath = join(runsDir, '.lifecycle.lock');

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock(lockPath, { timeout: 30000 });
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}
```

Alternatively, run both operations in a single sequential "lifecycle" scheduler instead of separate timers.

---

## Medium Impact, Low Effort

### 12. Extend Ring Buffer for Long-Running Processes

**Addresses:** [Risk #15] Early samples lost for long-running processes

Increase `maxSamples` from 360 to a configurable value, or implement a two-tier buffer:
- **Recent buffer:** Full resolution (every sample) for the last 30 minutes (360 samples at 5s)
- **Historical buffer:** Downsampled (every 12th sample = 1 per minute) for the previous 4 hours (240 samples)

Total memory cost: 600 samples * ~50 bytes = ~30 KB per process. Negligible.

This would allow leak detection over longer windows while maintaining recent-history precision.

### 13. Expose Memory Diagnostics in CLI

Add a `ndx memory` or `ndx diagnostics` command that reports:
- Current system memory (using the platform-specific reading)
- Current throttle status and config
- Active process count and memory
- Leak detection status
- Archival/retention statistics
- Browser memory level (if server is running)

This gives users visibility into why throttling is occurring and whether their configuration is appropriate for their platform.

---

## Low Impact, Low Effort

### 14. Add Platform Detection Logging

When the system memory monitor initializes, log which platform was detected and which reading strategy is being used:

```
[memory-monitor] Platform: linux, strategy: /proc/meminfo MemAvailable
[memory-monitor] Platform: darwin, strategy: os.freemem() (inactive pages not included)
[memory-monitor] Platform: win32, strategy: os.freemem() (GlobalMemoryStatusEx)
```

This makes it immediately clear when the less-accurate macOS path is active.

### 15. Unref All Background Timers

Verify that all `setInterval` timers used by schedulers (retention, cleanup, browser memory polling) call `.unref()` to prevent blocking process exit. The retention scheduler already does this, but this should be audited across all timer-based systems.

---

## Implementation Priority Matrix

| # | Improvement | Impact | Effort | Addresses |
|---|-----------|--------|--------|-----------|
| 1 | macOS vm_stat integration | High | Moderate | Risk #1 |
| 2 | Container cgroup detection | High | Moderate | Risk #2 |
| 3 | Async gzip compression | High | Moderate | Risk #3 |
| 4 | Complete deferred polling tasks | High | Moderate | Deferred tasks |
| 5 | Try-catch listener wrappers | High | Low | Risk #7 |
| 6 | Config consistency validation | High | Low | Risk #8 |
| 7 | Polling state error logging | High | Low | Risk #6 |
| 8 | Multi-strategy leak detection | Medium | Moderate | Risk #10 |
| 9 | Proactive retention warnings | Medium | Moderate | Risk #14 |
| 10 | Adaptive browser thresholds | Medium | Moderate | Risk #5, #13 |
| 11 | File locking coordination | Medium | Moderate | Risk #4 |
| 12 | Extended ring buffer | Medium | Low | Risk #15 |
| 13 | CLI diagnostics command | Medium | Low | General visibility |
| 14 | Platform detection logging | Low | Low | General visibility |
| 15 | Unref timer audit | Low | Low | Process exit cleanliness |

**Recommended order:** Items 5-7 (low effort, high reliability gain), then 1-2 (platform accuracy), then 3-4 (event loop and completeness), then 8-15 as capacity allows.
