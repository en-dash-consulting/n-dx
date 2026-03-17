# OS Memory Behavior: macOS, Linux, and Windows

How operating systems report memory availability, and the implications for n-dx's memory management system. Understanding these differences is essential because the system makes spawn/throttle decisions based on "available memory" -- a concept that each OS defines differently.

---

## The Core Problem

Node.js exposes two memory APIs via the `os` module:
- `os.totalmem()` -- total system RAM (reliable, consistent across platforms)
- `os.freemem()` -- "free" memory (unreliable, meaning varies by OS)

The gap between "free memory" and "actually available memory" is significant. Every modern OS uses unused RAM for disk caching, and whether that cache-occupied RAM is reported as "free" depends on the platform.

---

## Linux

### Memory Reporting

Linux provides the most accurate available-memory metric through `/proc/meminfo`:

```
MemTotal:       16384000 kB
MemFree:         1024000 kB    <-- genuinely unused pages
MemAvailable:    8192000 kB    <-- what the system can actually allocate
Buffers:          512000 kB
Cached:          6656000 kB
```

**`MemAvailable`** (available since Linux 3.14, March 2014) accounts for:
- Free pages (`MemFree`)
- Page cache that the kernel can reclaim under pressure
- Reclaimable slab memory
- Minus a reserve for low-watermark protection

This is the metric n-dx reads on Linux, falling back to `os.freemem()` (which maps to `MemFree`) if `/proc/meminfo` is unreadable.

### Why MemFree Is Misleading on Linux

A healthy Linux system with 16 GB RAM might report only 1 GB `MemFree` while having 8 GB `MemAvailable`. The kernel aggressively uses unused RAM for page cache (file-backed pages that are instantly reclaimable). Using `MemFree` for spawn decisions would cause the throttle to trigger at 93% "usage" when the system actually has 50% available.

### n-dx Implementation

```
Platform detected: linux
  --> Read /proc/meminfo (async)
  --> Parse MemAvailable via regex: /^MemAvailable:\s+(\d+)\s+kB$/m
  --> Convert kB to bytes
  --> If read fails: fallback to os.freemem()
```

### Linux-Specific Quirks

| Behavior | Impact | Notes |
|----------|--------|-------|
| OOM killer | Processes can be killed without warning when the system runs out of memory | n-dx's throttle aims to prevent reaching this point |
| Memory overcommit | `vm.overcommit_memory=1` allows allocations to succeed even without backing RAM | Spawn checks may pass but the process could be OOM-killed later |
| cgroups v2 limits | Container environments may restrict memory below physical RAM | `/proc/meminfo` still shows host memory; cgroup limits are separate |
| Transparent Huge Pages | Can cause memory fragmentation and latency spikes | Not directly relevant to available-memory reporting |
| Swap | Swap-backed memory is not counted as available | High swap usage can mask the severity of memory pressure |

### Container Environments (Docker, Kubernetes)

When running inside a container, `/proc/meminfo` reflects **host** memory, not the container's cgroup limit. This is a known limitation:
- A container with a 2 GB memory limit on a 64 GB host will see 64 GB in `/proc/meminfo`
- The throttle would never trigger because host memory appears plentiful
- The container's cgroup OOM killer will kill the process at the 2 GB limit regardless

To get accurate readings in containers, the system would need to read `/sys/fs/cgroup/memory.max` (cgroups v2) or `/sys/fs/cgroup/memory/memory.limit_in_bytes` (cgroups v1).

---

## macOS (Darwin)

### Memory Reporting

macOS uses the Mach virtual memory system. Node.js `os.freemem()` maps to Darwin's `vm_stat` "free pages" count.

macOS classifies physical memory into four categories:
- **Free** -- pages not in use at all
- **Active** -- pages recently accessed and in active use
- **Inactive** -- pages not recently accessed but still in RAM (reclaimable)
- **Wired** -- pages locked in memory (kernel, drivers), never paged out

`os.freemem()` on macOS returns only the **Free** pages count, which is typically very low on a healthy system because macOS aggressively fills RAM with file cache.

### Why os.freemem() Is Misleading on macOS

macOS memory pressure is better indicated by the combination of Free + Inactive pages, or ideally by the system's own memory pressure level. A Mac with 32 GB RAM might report 500 MB "free" while actually being under no memory pressure because 10 GB of Inactive pages can be instantly reclaimed.

### n-dx Implementation

```
Platform detected: darwin
  --> os.freemem() (vm_stat free pages * page size)
  --> os.totalmem() (hw.memsize sysctl)
  --> Usage = (total - free) / total * 100
```

### macOS-Specific Quirks

| Behavior | Impact | Notes |
|----------|--------|-------|
| Memory Compression | macOS compresses inactive pages instead of swapping to disk | Compressed memory appears as "used" but is partially reclaimable |
| Unified Memory (Apple Silicon) | GPU and CPU share the same physical RAM pool | GPU-intensive workloads reduce available system memory |
| App Nap | macOS suspends background apps and reduces their memory priority | Dashboard tab in background may have memory reclaimed by OS |
| Memory Pressure events | macOS has a kernel-level memory pressure notification system | Not accessible from Node.js -- only from native Mach APIs |
| Swap (compressed) | macOS swaps compressed pages, making swap usage less predictable | Small swap file does not necessarily mean low pressure |

### Practical Impact

Because `os.freemem()` underreports available memory on macOS, the throttle may trigger earlier than necessary. A system reporting 85% usage (triggering delay) might actually have 40% of RAM reclaimable from inactive pages and compression. This is a conservative bias -- it errs on the side of caution but may unnecessarily throttle executions on macOS systems with plenty of reclaimable memory.

---

## Windows

### Memory Reporting

Node.js `os.freemem()` on Windows maps to `GlobalMemoryStatusEx.ullAvailPhys`, which returns **available physical memory**. This is the most accurate of the three platforms for the simple `os.freemem()` call.

Windows available memory includes:
- Free pages (zeroed and standby list)
- Standby pages (file cache, reclaimable)
- Modified pages that can be written and freed

### Why Windows Is Actually the Best Case

Unlike Linux (`MemFree` vs. `MemAvailable`) and macOS (Free pages only), Windows `GlobalMemoryStatusEx.ullAvailPhys` already accounts for reclaimable cache. `os.freemem()` on Windows returns what you actually want: memory the system can make available for new allocations.

### n-dx Implementation

```
Platform detected: win32
  --> os.freemem() (GlobalMemoryStatusEx.ullAvailPhys)
  --> os.totalmem() (GlobalMemoryStatusEx.ullTotalPhys)
  --> Usage = (total - free) / total * 100
```

### Windows-Specific Quirks

| Behavior | Impact | Notes |
|----------|--------|-------|
| Working Set trimming | Windows trims process working sets under pressure | Process RSS may drop without actual deallocation |
| Commit charge | Windows tracks committed virtual memory separately | A process can commit more memory than physical RAM (backed by page file) |
| Page file | Windows swap equivalent | Available physical memory can be low while commit charge has headroom |
| Superfetch/SysMain | Preloads frequently used data into standby cache | Reported correctly as available/reclaimable by GlobalMemoryStatusEx |
| NUMA awareness | Multi-socket systems may have uneven memory distribution | `os.freemem()` returns system-wide totals, not per-NUMA-node |

---

## Browser Memory (Client-Side)

The web dashboard monitors browser JS heap memory through `performance.memory`, a Chromium-specific API.

### Chrome/Edge/Chromium

```typescript
performance.memory = {
  usedJSHeapSize:   // bytes currently allocated on the JS heap
  totalJSHeapSize:  // total heap allocated (includes free space within heap)
  jsHeapSizeLimit:  // maximum heap size (V8's configured limit)
}
```

- `usageRatio = usedJSHeapSize / jsHeapSizeLimit`
- Provides precise readings with `precise: true` flag in snapshots

### Firefox, Safari, Other Browsers

`performance.memory` is not available. The system falls back to:
- All heap sizes reported as -1
- A hardcoded 2 GB fallback heap limit for level classification
- `precise: false` in snapshots

### Browser Memory Quirks

| Behavior | Impact | Notes |
|----------|--------|-------|
| V8 garbage collection | GC pauses can cause temporary spikes in `usedJSHeapSize` | Snapshots taken mid-GC may over-report usage |
| Tab throttling | Chrome throttles background tabs after 5 minutes | Polling intervals may not fire at expected rates |
| Tab freezing | Chrome may freeze background tabs entirely | Memory monitor stops collecting, recovery detection delayed |
| Site isolation | Each origin gets its own renderer process | `jsHeapSizeLimit` is per-renderer, not per-tab |
| Cross-origin iframes | Each cross-origin iframe has a separate heap | Dashboard's heap measurement doesn't include iframe heaps |
| `jsHeapSizeLimit` variability | V8 adjusts heap limit dynamically based on system RAM | Limit may change between snapshots |

---

## Platform Comparison Summary

| Aspect | Linux | macOS | Windows |
|--------|-------|-------|---------|
| **Free memory API** | `os.freemem()` = `MemFree` (misleading) | `os.freemem()` = vm_stat free pages (misleading) | `os.freemem()` = available physical (accurate) |
| **n-dx reads** | `/proc/meminfo` `MemAvailable` (accurate) | `os.freemem()` (underestimates availability) | `os.freemem()` (accurate) |
| **Cache handling** | Page cache counted as available via `MemAvailable` | Inactive pages NOT counted as free | Standby pages counted as available |
| **Memory compression** | zswap/zram (optional, not default) | Always active (transparent to app) | Not used for RAM (page file only) |
| **Overcommit** | Configurable, can cause silent OOM kills | No overcommit by default | Backed by commit charge / page file |
| **Container accuracy** | `/proc/meminfo` shows host, not cgroup | N/A (no native container support) | Hyper-V containers vary |
| **Accuracy rating** | High (with MemAvailable) | Low (conservative bias) | High |

---

## Recommendations by Platform

### Linux
- **Production environments:** The current `/proc/meminfo` parsing is the correct approach. Ensure the fallback to `os.freemem()` is flagged in diagnostics since it will cause premature throttling.
- **Containers:** Be aware that memory limits are invisible. See [Areas of Improvement](./memory-improvements.md) for container-aware monitoring suggestions.

### macOS
- **Development machines:** Expect the throttle to be more conservative than necessary. Developers may want to raise `delayThreshold` from 80% to 85-90% to account for macOS's aggressive caching.
- **Apple Silicon:** Unified memory means GPU workloads compete with n-dx for the same RAM pool.

### Windows
- **Most accurate out of the box.** No special handling needed. Default thresholds should work as intended.
- **WSL:** If running Node.js inside WSL, Linux behavior applies (reads `/proc/meminfo` from the WSL kernel, which may or may not reflect actual Windows availability depending on WSL version).
