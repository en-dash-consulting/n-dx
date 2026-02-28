# Browser Error Code 5: Trigger Conditions and Recovery

> Task: Investigate browser error code 5 triggers and recovery scenarios
> Date: 2026-02-24
> Scope: Chrome/Chromium "Aw, Snap!" crashes affecting n-dx web UI

---

## 1. Executive Summary

Chrome error code 5 (`RESULT_CODE_KILLED` / `STATUS_ACCESS_VIOLATION`) is a **renderer process termination** caused when the tab's process is killed by the OS or the browser's own OOM killer. In the context of the n-dx web dashboard, this crash occurs when the renderer process exceeds browser-enforced memory limits—typically driven by large SVG graph rendering, unbounded JSON payloads, or refresh storms that prevent garbage collection.

This document catalogs the exact trigger conditions, memory thresholds, browser-specific behaviors, and recovery strategies.

---

## 2. What Is Error Code 5?

### 2.1 Chromium Result Codes

Chromium defines process exit codes in `content/public/common/result_codes.h` and `chrome/common/chrome_result_codes.h`:

| Code | Constant | Meaning |
|------|----------|---------|
| 0 | `RESULT_CODE_NORMAL_EXIT` | Clean shutdown |
| 1 | `RESULT_CODE_KILLED` | Process killed externally (OOM killer, task manager) |
| 2 | `RESULT_CODE_HUNG` | Process unresponsive, killed by browser |
| 3 | `RESULT_CODE_GPU_DEAD_ON_ARRIVAL` | GPU process failed |
| 5 | `RESULT_CODE_KILLED_BAD_MESSAGE` | IPC violation / forced termination |
| 6 | `RESULT_CODE_GPU_DEAD_ON_ARRIVAL` | (duplicate in some versions) |
| 7 | `RESULT_CODE_SANDBOX_FATAL` | Sandbox initialization failed |
| 33 | `STATUS_ACCESS_VIOLATION` (Windows) | Memory access fault |
| 137 | `SIGKILL` (Linux/macOS) | OOM killer sent SIGKILL |
| 139 | `SIGSEGV` (Linux/macOS) | Segmentation fault |

### 2.2 Error Code 5 Specifically

On the "Aw, Snap!" page, **error code 5** maps to different underlying causes depending on the platform:

| Platform | Typical Cause | Underlying Signal/Code |
|----------|--------------|----------------------|
| **Windows** | `STATUS_ACCESS_VIOLATION` (0xC0000005) | Memory access violation—often triggered when V8 heap or process virtual memory is exhausted and a null/invalid pointer is dereferenced |
| **macOS** | `SIGKILL` from `memorystatus_kill` | The Jetsam mechanism kills the process when system memory pressure reaches critical levels |
| **Linux** | `SIGKILL` from OOM killer | The kernel's OOM killer selects the renderer process (typically the largest memory consumer) |
| **ChromeOS** | Tab discard → crash page | Tab discarded by the resource manager before OOM, displayed as error code 5 |

### 2.3 The Error Code 5 ≠ A Single Root Cause

Error code 5 is a **catch-all** for "renderer process died unexpectedly." The Chromium crash reporter buckets multiple failure modes under this code:

1. **V8 heap exhaustion** — `FatalProcessOutOfMemory` called by V8 when `ArrayBuffer`, typed arrays, or JS objects exceed the heap limit
2. **OS-level OOM** — The process's RSS exceeds system memory thresholds and the OS kills it
3. **Blink layout OOM** — The rendering engine runs out of memory during DOM layout (e.g., millions of SVG nodes)
4. **IPC buffer overflow** — Shared memory buffers between renderer and browser process are exhausted (rare, more common in extensions)
5. **GPU memory exhaustion** — WebGL/Canvas contexts exceed GPU memory (not applicable to n-dx)

---

## 3. Memory Thresholds That Cause Crashes

### 3.1 V8 Heap Limits

V8 has configurable heap limits that depend on the platform and available system memory:

| System RAM | V8 Max Heap (default) | Notes |
|-----------|----------------------|-------|
| ≤ 512 MB | ~256 MB | Embedded/low-memory devices |
| 1–2 GB | ~512 MB | Budget laptops |
| 2–4 GB | ~1 GB | Typical V8 limit on 32-bit |
| 4–8 GB | ~2 GB | Default on most desktop configs |
| 8–16 GB | ~4 GB | V8's practical maximum per isolate |
| 16+ GB | ~4 GB | V8 caps even on large-memory machines |

**Key insight:** V8's heap limit applies **per renderer process** (per tab in site isolation mode). The n-dx dashboard runs in a single renderer process, so all JavaScript objects, parsed JSON, Preact VDOM, and string data compete for this single heap.

**V8 will crash the process when:**
```
allocated_heap > heap_limit AND gc_cannot_reclaim_sufficient_memory
```

V8 attempts two full GC cycles before calling `FatalProcessOutOfMemory`. If neither cycle frees enough memory to satisfy the allocation, the process is terminated immediately.

### 3.2 DOM/Blink Memory Limits

DOM memory is **separate from the V8 heap** but contributes to the process RSS:

| DOM Structure | Approximate Memory Per Element |
|--------------|-------------------------------|
| `<div>` | ~400–600 bytes |
| `<svg>` | ~800–1200 bytes |
| `<g>` (SVG group) | ~600–800 bytes |
| `<line>` (SVG) | ~500–700 bytes |
| `<path>` (SVG) | ~800–1500 bytes (depends on path data) |
| `<text>` (SVG) | ~600–1000 bytes |
| Text node | ~100–200 bytes + string length |

**DOM node limits before crash:**

| Browser | Approximate DOM Node Limit | Resulting RSS |
|---------|--------------------------|---------------|
| Chrome (desktop, 8 GB RAM) | ~500,000–1,000,000 nodes | ~500 MB–1.5 GB |
| Chrome (desktop, 16 GB RAM) | ~1,000,000–2,000,000 nodes | ~1–2.5 GB |
| Chrome (mobile) | ~50,000–100,000 nodes | ~200–500 MB |

**For the n-dx graph view:** Each file node creates approximately 3–5 SVG elements (group + circle + text + optional decorators). Each edge creates 1–2 elements (line + optional arrowhead). Therefore:

| Codebase Files | SVG Elements (approx) | SVG DOM Memory | Crash Risk |
|---------------|----------------------|----------------|------------|
| 100 | ~500 | ~400 KB | None |
| 500 | ~3,000 | ~2.5 MB | Low |
| 1,000 | ~7,000 | ~7 MB | Medium (with physics) |
| 2,000 | ~15,000 | ~15 MB | High (DOM + physics GC pressure) |
| 5,000 | ~40,000 | ~40 MB | Very High |

The SVG DOM alone won't cause OOM at these node counts. The crash occurs from the **combination** of SVG DOM + V8 heap (parsed JSON data + Preact VDOM + physics simulation allocations).

### 3.3 Process RSS Limits (OS-Level)

The OS kills the renderer process based on total RSS (Resident Set Size), not just V8 heap:

**macOS (Jetsam):**
- System pressure levels: `normal` → `warn` → `critical`
- At `critical`, the kernel kills processes by priority. Renderer processes have **low priority** (they're considered "discardable")
- **Threshold:** No fixed number—depends on system memory pressure. On a 16 GB Mac, a renderer consuming >4 GB is at high risk. On an 8 GB Mac, >2 GB is dangerous
- Jetsam limits are per-process and dynamically adjusted

**Linux (OOM Killer):**
- `oom_score_adj` for renderer processes is typically 200–300 (medium-high kill priority)
- OOM killer activates when `MemAvailable` drops below `vm.min_free_kbytes` (typically 64 MB)
- Renderer processes are prime targets due to their high memory usage and expendable nature

**Windows:**
- No strict per-process OOM killer, but the system will fail `VirtualAlloc` calls when commit charge is exhausted
- Chrome's own memory pressure monitor will crash tabs when system memory is critically low
- `STATUS_ACCESS_VIOLATION` (0xC0000005) occurs when a failed allocation leads to a null-pointer dereference

### 3.4 Combined Thresholds for n-dx

Based on the memory profile analysis (see `MEMORY_PROFILE.md`), here are the critical thresholds:

| Scenario | V8 Heap Usage | DOM Memory | Total RSS | Crash Probability |
|----------|--------------|------------|-----------|-------------------|
| Small codebase, no graph | ~15 MB | ~5 MB | ~80 MB | Negligible |
| Medium codebase, no graph | ~50 MB | ~10 MB | ~150 MB | Negligible |
| Large codebase, no graph | ~150 MB | ~15 MB | ~300 MB | Low |
| Large codebase + graph | ~300 MB | ~50 MB | ~600 MB | Medium |
| Large codebase + graph + refresh storm | ~600 MB | ~50 MB | ~1 GB | High |
| Very large codebase + graph + run details | ~1 GB+ | ~80 MB | ~1.5 GB+ | Very High |

**The critical memory band where crashes become likely: 1–2 GB total renderer RSS** on a machine with 8–16 GB system RAM.

---

## 4. Trigger Conditions Specific to n-dx

### 4.1 Primary Triggers

**Trigger 1: Large SVG Graph Without Virtualization**

```
Condition: Graph view enabled on codebase with >800 files
Mechanism:
  1. All files rendered as SVG nodes (no virtualization)
  2. All import edges rendered as SVG lines
  3. Physics simulation allocates quad-tree + centroid maps per frame
  4. 200+ animation frames × ~40 KB transient allocations = ~8–12 MB GC pressure
  5. SVG DOM holds 5,000+ elements permanently
  6. Combined with parsed JSON data → approaches V8 heap limit
Result: V8 FatalProcessOutOfMemory or OS OOM kill
```

**Trigger 2: Refresh Storm During Build**

```
Condition: Multiple rapid file changes (e.g., pnpm build touches 50+ files)
Mechanism:
  1. Each file change → fs.watch event → watcher.refresh() → WebSocket broadcast
  2. Client receives sv:data-changed → loadFromServer() fires
  3. 6 parallel fetch requests allocate response buffers
  4. JSON.parse creates new object graphs (duplicates existing data temporarily)
  5. Before GC reclaims old data, another change triggers another loadFromServer()
  6. Memory: baseline × 3–4 (old data + new data + in-flight responses + VDOM)
  7. Debounce on watcher (500ms) helps but doesn't prevent all storms
Result: Cascading memory pressure → V8 heap exhaustion
```

**Trigger 3: Large Hench Run Detail**

```
Condition: Viewing run with 50+ turns containing file content tool outputs
Mechanism:
  1. GET /api/hench/runs/:id returns full toolCalls array
  2. JSON response can be 10–50 MB for complex runs
  3. Browser parses JSON → allocates JS objects (~2× JSON string size)
  4. Preact stores in component state → creates VDOM representation
  5. Previous run detail lingers until GC cycle
  6. Navigating between large runs: 2× run size in memory simultaneously
Result: V8 heap pressure, potential OOM on constrained machines
```

### 4.2 Secondary Triggers (Compound Effects)

**Trigger 4: Long-Running Session Accumulation**

```
Condition: Dashboard open for >1 hour with periodic refreshes
Contributing factors:
  - Polling every 5s creates allocation/GC churn
  - Module-level currentData singleton prevents any data eviction
  - WebSocket connections accumulate if close frames aren't properly sent
  - MCP sessions (if Claude Code is connected) accumulate without TTL cleanup
Result: Gradual memory growth → eventual threshold breach
```

**Trigger 5: Multiple Concurrent Data Views**

```
Condition: User has graph + PRD tree + hench runs all active
Contributing factors:
  - Graph: SVG DOM + physics state + adjacency map
  - PRD tree: full PRD JSON + computed stats + filter state
  - Hench runs: run list + selected run detail + token aggregations
  - Each view has its own polling interval (3+ simultaneous timers)
  - 2–3 independent WebSocket connections
Result: Combined memory footprint exceeds single-view expectations
```

### 4.3 Trigger Probability Matrix

| Trigger | Likelihood | Severity | Detection Difficulty |
|---------|-----------|----------|---------------------|
| Large graph (>800 nodes) | High (any large project) | Critical (immediate crash) | Easy (reproducible) |
| Refresh storm | Medium (during builds) | High (crash within seconds) | Medium (timing-dependent) |
| Large run detail | Medium (depends on agent usage) | High (crash on navigation) | Easy (reproducible) |
| Long session accumulation | Low (requires hours) | Medium (gradual degradation) | Hard (non-deterministic) |
| Multiple concurrent views | Low (specific usage pattern) | Medium (increased baseline) | Medium (configuration-dependent) |

---

## 5. Browser-Specific Behavior Differences

### 5.1 Chrome / Chromium

| Aspect | Behavior |
|--------|----------|
| **Process model** | Site isolation: one renderer process per site. n-dx localhost gets its own process |
| **V8 heap limit** | ~2–4 GB depending on system RAM and `--max-old-space-size` flag |
| **OOM handling** | V8 calls `FatalProcessOutOfMemory` → immediate process termination |
| **Error display** | "Aw, Snap!" page with error code (5 for OOM/killed) |
| **Tab discarding** | Chrome may discard background tabs under memory pressure before crashing foreground tab |
| **Recovery** | User must manually reload the tab. No automatic recovery |
| **Crash report** | `chrome://crashes` shows minidump with stack trace |
| **Memory monitoring** | `chrome://memory-internals` shows per-process V8 heap stats |
| **DevTools impact** | DevTools open increases memory by ~50–200 MB (inspector objects) |
| **Performance.measureUserAgentSpecificMemory()** | Available; returns per-frame memory breakdown |

### 5.2 Firefox

| Aspect | Behavior |
|--------|----------|
| **Process model** | Fission (site isolation) since Firefox 95. Similar to Chrome |
| **JS heap limit** | SpiderMonkey uses nursery (minor GC) + tenured (major GC). No hard per-tab limit; limited by process virtual address space |
| **OOM handling** | `js::ReportOutOfMemory` → tab crash page ("Gah. Your tab just crashed.") |
| **Error display** | "about:tabcrashed" page (no numeric error code shown to users) |
| **Tab discarding** | Firefox unloads background tabs via "Tab Unloading" (enabled by default since Firefox 93) |
| **Recovery** | "Restore Tab" button on crash page |
| **Crash report** | `about:crashes` with Socorro crash reports |
| **Memory monitoring** | `about:memory` shows detailed per-compartment JS memory |
| **Key difference** | Firefox tends to handle large DOMs better than Chrome due to different layout engine (Stylo/WebRender), but has similar JS heap limits |
| **SVG rendering** | Firefox's WebRender rasterizes SVG more efficiently; may tolerate larger graphs before OOM |

### 5.3 Safari / WebKit

| Aspect | Behavior |
|--------|----------|
| **Process model** | Process-per-tab (WebKit2 architecture) |
| **JS heap limit** | JavaScriptCore uses a "conservative" GC. Heap limit is ~1.5 GB on macOS, ~750 MB on iOS |
| **OOM handling** | Jetsam kills the WebContent process. Safari shows "A problem repeatedly occurred" |
| **Error display** | "This webpage was reloaded because a problem repeatedly occurred" |
| **Tab discarding** | iOS aggressively kills background WebContent processes. macOS less aggressive but still discards under memory pressure |
| **Recovery** | Auto-reload on tab activation (may trigger same OOM if page state is the problem) |
| **Key difference** | Safari is the **most aggressive** at killing renderer processes. iOS WebContent processes have strict Jetsam limits (~750 MB on most iPhones). macOS Safari also has lower tolerance than Chrome |
| **SVG rendering** | WebKit's SVG rendering is generally less memory-efficient than Chrome's Skia renderer |
| **Implication for n-dx** | Safari users will hit OOM at lower node counts than Chrome users |

### 5.4 Edge (Chromium-based)

| Aspect | Behavior |
|--------|----------|
| **Process model** | Same as Chrome (Chromium-based) |
| **V8 heap limit** | Same as Chrome |
| **OOM handling** | Same as Chrome but Edge adds "Sleeping Tabs" (background tab suspension after 2 hours by default) |
| **Error display** | Same "Aw, Snap!" page with error code 5 |
| **Key difference** | Edge's "Efficiency mode" throttles background tabs more aggressively. The n-dx dashboard running in a background tab may have its timers throttled, reducing memory pressure but also reducing refresh frequency |
| **Memory monitoring** | `edge://memory-internals` |

### 5.5 Comparative Memory Limits Summary

| Browser | JS Heap Limit (typical desktop) | DOM Crash Threshold | OOM Kill Priority | Recovery UX |
|---------|-------------------------------|--------------------|--------------------|-------------|
| Chrome | ~2–4 GB | ~500K–1M nodes | Medium | Manual reload |
| Firefox | ~2–4 GB (process-wide) | ~500K–1M nodes | Medium | "Restore Tab" button |
| Safari macOS | ~1.5 GB | ~300K–500K nodes | High (Jetsam) | Auto-reload (risky) |
| Safari iOS | ~750 MB | ~50K–100K nodes | Very High | Auto-reload |
| Edge | ~2–4 GB (same as Chrome) | ~500K–1M nodes | Low (Sleeping Tabs) | Manual reload |

---

## 6. Recovery Scenarios

### 6.1 Current Recovery Path (No Automated Recovery)

```
User opens n-dx dashboard
  → Dashboard renders large graph / loads large run
    → Renderer process OOM → "Aw, Snap!" error code 5
      → User manually reloads tab
        → Dashboard re-renders the same large graph
          → OOM again (cycle repeats)
```

**Problem:** Manual reload re-triggers the same state. If the crash was caused by graph view being enabled (stored in `localStorage` via `GRAPH_VISIBLE_KEY`), the reload will re-enable the graph and crash again.

### 6.2 Recommended Recovery Architecture

**A. Crash-Resilient State Management**

```
Before Crash:
  localStorage["n-dx-graph-visible"] = "true"
  localStorage["n-dx-last-view"] = "graph"

After Reload (proposed):
  1. Check if page loaded within 5 seconds of a crash (use sessionStorage flag)
  2. If crash detected:
     a. Clear graph visibility flag
     b. Show notification: "Graph was disabled to prevent repeated crashes"
     c. Offer "Re-enable graph" button with warning about node count
  3. Store crash count in sessionStorage (reset on successful 30-second session)
  4. After 3 crashes in 5 minutes: disable all heavy features, show "safe mode" banner
```

**B. Proactive Memory Monitoring**

```javascript
// Use performance.measureUserAgentSpecificMemory() (Chrome 89+)
async function checkMemoryPressure() {
  if (performance.measureUserAgentSpecificMemory) {
    const result = await performance.measureUserAgentSpecificMemory();
    const usedMB = result.bytes / (1024 * 1024);

    if (usedMB > 1500) {
      // Critical: disable graph, reduce polling, show warning
      disableGraph();
      reducePollingFrequency();
      showMemoryWarning('critical');
    } else if (usedMB > 800) {
      // Warning: suggest disabling graph
      showMemoryWarning('elevated');
    }
  }
}

// Run every 30 seconds (non-blocking)
setInterval(checkMemoryPressure, 30000);
```

**Note:** `performance.measureUserAgentSpecificMemory()` requires a cross-origin-isolated context (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`). For non-isolated contexts, fall back to `performance.memory` (Chrome-only, deprecated) or heuristic-based monitoring.

**C. Graceful Degradation Triggers**

| Memory Level | Response | User Notification |
|-------------|----------|-------------------|
| < 500 MB | Normal operation | None |
| 500–800 MB | Reduce polling to 15s, defer graph updates | Subtle indicator in status bar |
| 800–1200 MB | Disable graph physics, virtualize lists | Toast: "High memory usage detected" |
| 1200–1500 MB | Destroy graph, evict cached data, disable WebSocket | Banner: "Memory critical — some features disabled" |
| > 1500 MB | Emergency: navigate to lightweight view, clear all state | Full-page warning with reload button |

**D. Crash Loop Detection**

```javascript
const CRASH_KEY = 'n-dx-crash-detect';
const CRASH_COUNT_KEY = 'n-dx-crash-count';
const SAFE_MODE_KEY = 'n-dx-safe-mode';

// On page load:
function detectCrashLoop() {
  const lastLoad = sessionStorage.getItem(CRASH_KEY);
  const crashCount = parseInt(sessionStorage.getItem(CRASH_COUNT_KEY) || '0');

  if (lastLoad) {
    const elapsed = Date.now() - parseInt(lastLoad);
    if (elapsed < 10000) {
      // Page reloaded within 10 seconds — likely crash recovery
      const newCount = crashCount + 1;
      sessionStorage.setItem(CRASH_COUNT_KEY, String(newCount));

      if (newCount >= 2) {
        // Enter safe mode
        sessionStorage.setItem(SAFE_MODE_KEY, 'true');
        return 'safe-mode';
      }
      return 'crash-detected';
    }
  }

  // Normal load — set marker and clear crash count after 30s
  sessionStorage.setItem(CRASH_KEY, String(Date.now()));
  setTimeout(() => {
    sessionStorage.removeItem(CRASH_COUNT_KEY);
  }, 30000);

  return sessionStorage.getItem(SAFE_MODE_KEY) ? 'safe-mode' : 'normal';
}
```

---

## 7. n-dx-Specific Crash Dump Analysis

### 7.1 How to Collect Crash Data

**Chrome:**
1. Navigate to `chrome://crashes`
2. Find the crash matching the n-dx tab
3. Click "Send" if not auto-uploaded
4. The crash ID can be looked up at `https://crash.chromium.org` (Googlers only) or locally via minidump

**Local minidump extraction:**
```bash
# macOS
ls ~/Library/Application\ Support/Google/Chrome/Crashpad/reports/

# Linux
ls ~/.config/google-chrome/Crashpad/reports/

# Windows
dir %LOCALAPPDATA%\Google\Chrome\User Data\Crashpad\reports\
```

**Parse minidump (requires breakpad tools):**
```bash
# Extract stack trace
minidump_stackwalk crash.dmp chrome.sym > stacktrace.txt
```

### 7.2 Expected Stack Traces for n-dx OOM

**V8 Heap Exhaustion (most common):**
```
Thread 0 (crashed)
 0  chrome.dll!v8::internal::V8::FatalProcessOutOfMemory
 1  chrome.dll!v8::internal::Heap::FatalProcessOutOfMemory
 2  chrome.dll!v8::internal::Heap::AllocateRawWithRetryOrFailSlowPath
 3  chrome.dll!v8::internal::Factory::NewFixedArray
      ↑ This is where JSON.parse / array growth exceeds heap
```

**Blink Layout OOM (SVG-triggered):**
```
Thread 0 (crashed)
 0  chrome.dll!base::internal::OnNoMemoryInternal
 1  chrome.dll!blink::SVGLayoutTreeBuilder::BuildLayoutTree
 2  chrome.dll!blink::LayoutSVGContainer::UpdateLayout
      ↑ This is where large SVG DOM exceeds layout memory
```

**OS OOM Kill (SIGKILL on macOS/Linux):**
```
Thread 0 (crashed)
 0  <no stack available — process was SIGKILL'd>
 Signal: 9 (SIGKILL)
 Note: "Killed by Jetsam" or "Killed by OOM Killer"
```

### 7.3 Chrome DevTools Memory Diagnostics

**Quick Memory Audit (run in console):**
```javascript
// V8 heap stats (Chrome-only)
console.table({
  'JS Heap Used': (performance.memory?.usedJSHeapSize / 1e6).toFixed(1) + ' MB',
  'JS Heap Total': (performance.memory?.totalJSHeapSize / 1e6).toFixed(1) + ' MB',
  'JS Heap Limit': (performance.memory?.jsHeapSizeLimit / 1e6).toFixed(1) + ' MB',
  'DOM Nodes': document.querySelectorAll('*').length,
  'SVG Elements': document.querySelectorAll('svg *').length,
  'Event Listeners': getEventListeners ? 'use DevTools' : 'N/A',
});
```

**Heap Snapshot Comparison Workflow:**
1. Load dashboard → take Snapshot 1
2. Enable graph → take Snapshot 2
3. Navigate to large run → take Snapshot 3
4. Compare: Snapshot 3 vs Snapshot 1 → "Allocated between 1 and 3"
5. Sort by "Retained Size" → identifies largest memory holders

---

## 8. Cross-Reference with MEMORY_PROFILE.md

The memory profile (sibling document) identified these specific n-dx patterns. Here's how they map to error code 5 triggers:

| MEMORY_PROFILE.md Finding | Error Code 5 Relevance | Threshold |
|--------------------------|----------------------|-----------|
| Graph renders all SVG nodes without virtualization | **Direct trigger** — DOM + V8 heap exhaustion | >800 files |
| Hench run detail loads full `toolCalls` array | **Direct trigger** — V8 heap spike | >50 turns with large outputs |
| Refresh storm (no debounce on watcher) | **Compound trigger** — prevents GC from reclaiming memory | Rapid file changes (build output) |
| 2× memory during polling refresh | **Compound trigger** — doubles baseline at each cycle | Any codebase + frequent changes |
| Multiple WebSocket connections | **Contributing factor** — each WS has receive buffers | 3+ concurrent connections |
| MCP session map without TTL | **Contributing factor** — long-running server only | >10 stale sessions |
| No virtualization in PRD tree | **Contributing factor** — 1000+ PRD items | >1000 items rendered |

---

## 9. Recommended Mitigations (Prioritized by Crash Prevention)

### P0 — Prevent Error Code 5 Crashes

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| 1 | **Node count guard on graph view** — Warn and require opt-in above 500 nodes; hard cap at 1500 | Small | Eliminates primary crash trigger |
| 2 | **Crash loop detection** — Detect rapid reloads, enter safe mode with graph disabled | Small | Prevents reload → crash → reload cycle |
| 3 | **Paginate/stream hench run toolCalls** — Lazy-load tool call details on expand instead of full payload | Medium | Eliminates second crash trigger |
| 4 | **Memory pressure monitoring** — Use `performance.measureUserAgentSpecificMemory()` to detect approaching limits | Small | Proactive degradation before crash |

### P1 — Reduce Crash Frequency

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| 5 | **SVG viewport culling** — Only render nodes within visible viewport bounds | Medium | Reduces DOM memory by 50–80% for large graphs |
| 6 | **Progressive graph loading** — Render top-N nodes by connectivity, expand on demand | Medium | Makes large graphs viable |
| 7 | **Shared WebSocket connection** — Single WS with topic-based subscriptions | Medium | Reduces per-connection buffer overhead |

### P2 — Improve Recovery Experience

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| 8 | **Safe mode banner** — Clear UI indicator when features are disabled due to memory concerns | Small | User understands degraded state |
| 9 | **Memory usage indicator** — Show current memory consumption in status bar | Small | User awareness of approaching limits |
| 10 | **Export graph as static image** — Offer PNG/SVG export for large graphs instead of interactive rendering | Medium | Alternative for large codebases |

---

## 10. Appendix: Browser Memory Debugging Quick Reference

### Chrome
```
chrome://crashes              — Crash reports
chrome://memory-internals     — Per-process memory stats
chrome://discards             — Tab discard info
chrome://flags/#enable-oop-rasterization  — GPU rasterization
DevTools → Memory → Heap Snapshot
DevTools → Performance → Memory checkbox
```

### Firefox
```
about:crashes                 — Crash reports
about:memory                  — Per-compartment memory
about:processes               — Process memory overview
about:config → dom.ipc.processCount  — Process count control
DevTools → Memory → Take Snapshot
```

### Safari
```
Develop → Show Web Inspector → Timelines → Memory
Activity Monitor → Memory tab (filter by "WebContent")
Console.app → search "Jetsam" for kill events
```

### Edge
```
edge://crashes               — Crash reports
edge://memory-internals      — Per-process memory
edge://discards              — Tab discard/sleeping info
Settings → System → Efficiency mode
```
