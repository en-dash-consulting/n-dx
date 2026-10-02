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

n-dx reads this through plain `os.freemem()` — no `/proc/meminfo` parsing of its own. On libuv >= 1.45 (Node >= 22, the repo's engine floor), libuv's `uv_get_available_memory()` itself reads `MemAvailable` from `/proc/meminfo`; `os.freemem()` only falls back to `MemFree` on kernels that lack `MemAvailable` (< 3.14, March 2014).

### Why MemFree Is Misleading on Linux

A healthy Linux system with 16 GB RAM might report only 1 GB `MemFree` while having 8 GB `MemAvailable`. The kernel aggressively uses unused RAM for page cache (file-backed pages that are instantly reclaimable). Using `MemFree` for spawn decisions would cause the throttle to trigger at 93% "usage" when the system actually has 50% available.

### n-dx Implementation

```
Platform detected: linux
  --> os.freemem() (no /proc/meminfo parsing in n-dx itself)
  --> libuv >= 1.45 (Node >= 22): reads MemAvailable
  --> older kernels (< 3.14, no MemAvailable field): libuv falls back to MemFree
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

n-dx does **not** use `os.freemem()` on macOS. The shared reader in `@n-dx/llm-client` (`packages/llm-client/src/system-memory.ts`) spawns two read-only commands in parallel:

```
Platform detected: darwin
  --> vm_stat: (free + inactive + speculative + purgeable pages) x page size --> availableBytes
  --> sysctl kern.memorystatus_vm_pressure_level: 1 normal / 2 warn / 4 critical --> pressure
  --> both run via exec() in parallel, result cached 5s, never awaited by a request
  --> neither readable --> availableBytes: null, pressure: "unknown" (never 0, never os.freemem())
```

`kern.memorystatus_vm_pressure_level` is the kernel's own judgment and is what drives the dashboard's health display; `vm_stat`'s page counts drive the available-bytes figure.

### macOS-Specific Quirks

| Behavior | Impact | Notes |
|----------|--------|-------|
| Memory Compression | macOS compresses inactive pages instead of swapping to disk | Compressed memory appears as "used" but is partially reclaimable |
| Unified Memory (Apple Silicon) | GPU and CPU share the same physical RAM pool | GPU-intensive workloads reduce available system memory |
| App Nap | macOS suspends background apps and reduces their memory priority | Dashboard tab in background may have memory reclaimed by OS |
| Memory Pressure events | macOS has a kernel-level memory pressure notification system | Read via `sysctl kern.memorystatus_vm_pressure_level` (1/2/4 -> normal/warn/critical); n-dx does not use the full Mach notification API, just this one value |
| Swap (compressed) | macOS swaps compressed pages, making swap usage less predictable | Small swap file does not necessarily mean low pressure |

### Practical Impact

The shared reader counts `vm_stat`'s free, inactive, speculative and purgeable pages as available, and takes pressure straight from the kernel instead of deriving it from a free-pages approximation. Both commands run in parallel and the result is cached for 5 seconds; no request ever awaits a fresh `vm_stat`/`sysctl` spawn. If neither command can be read, the reading is `availableBytes: null` / `pressure: "unknown"` — and nothing (throttle, pre-spawn check, dashboard health, hub admission) flags, throttles, or queues a run on an unknown reading.

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

## One Reading, Shared by Every Consumer

macOS's `availableBytes`/`pressure` reading (and Linux/Windows's `os.freemem()` passthrough) lives in one place — `@n-dx/llm-client`'s `packages/llm-client/src/system-memory.ts` — and every consumer reads through it instead of calling `os.freemem()` on its own:

- hench's opt-in `MemoryThrottle` and its pre-spawn check
- the dashboard's memory status panel and the `/api/live` machine tile
- the hub's admission floor

**Unknown-reading rule:** when the underlying signal can't be read (darwin: both `vm_stat` and `sysctl` fail), the reading is `availableBytes: null` and `pressure: "unknown"` — never a fabricated `0` and never a silent fallback to `os.freemem()`. Every consumer treats "unknown" as "no signal available": nothing flags, throttles, or queues a run on it.

---

## Platform Comparison Summary

| Aspect | Linux | macOS | Windows |
|--------|-------|-------|---------|
| **Free memory API** | `os.freemem()` = `MemAvailable` via libuv >= 1.45 (falls back to `MemFree` only on kernels < 3.14) | `os.freemem()` = vm_stat free pages only (not what n-dx reads) | `os.freemem()` = available physical (accurate) |
| **n-dx reads** | `os.freemem()` (accurate; libuv already reads `MemAvailable`) | shared `@n-dx/llm-client` reader: `vm_stat` (free+inactive+speculative+purgeable pages) for bytes, `kern.memorystatus_vm_pressure_level` for pressure | `os.freemem()` (accurate) |
| **Cache handling** | Page cache counted as available via `MemAvailable` | Inactive/speculative/purgeable pages counted as available via `vm_stat` | Standby pages counted as available |
| **Memory compression** | zswap/zram (optional, not default) | Always active (transparent to app) | Not used for RAM (page file only) |
| **Overcommit** | Configurable, can cause silent OOM kills | No overcommit by default | Backed by commit charge / page file |
| **Container accuracy** | `/proc/meminfo` shows host, not cgroup | N/A (no native container support) | Hyper-V containers vary |
| **Accuracy rating** | High (`MemAvailable` via libuv) | High (reads reclaimable pages directly, pressure straight from the kernel) | High |

---

## Recommendations by Platform

### Linux
- **Production environments:** Plain `os.freemem()` is already the correct reading, since libuv >= 1.45 reads `MemAvailable` itself. Only on kernels without `MemAvailable` (< 3.14) does it fall back to `MemFree`; flag that fallback in diagnostics, since it will cause premature throttling.
- **Containers:** Be aware that memory limits are invisible. See [Areas of Improvement](/contributing/memory-system-improvements) for container-aware monitoring suggestions.

### macOS
- **Development machines:** The shared reader already counts reclaimable (inactive/speculative/purgeable) pages and reads kernel pressure directly, so no threshold adjustment is needed to account for macOS's caching behavior.
- **Apple Silicon:** Unified memory means GPU workloads compete with n-dx for the same RAM pool.

### Windows
- **Most accurate out of the box.** No special handling needed. Default thresholds should work as intended.
- **WSL:** If running Node.js inside WSL, Linux behavior applies (reads `/proc/meminfo` from the WSL kernel, which may or may not reflect actual Windows availability depending on WSL version).

---

**Related memory documentation**

- [Memory Management Architecture](/architecture/memory-architecture) — system overview across the three tiers
- [Risks and Flaws](/contributing/memory-system-risks) — known issues by severity
- [Areas of Improvement](/contributing/memory-system-improvements) — prioritized fixes, each referencing a risk
- [Refresh Memory Analysis](/contributing/refresh-memory-analysis) — dated profiling of `ndx refresh`
- [Memory OS Behavior](/process/memory-os-behavior) — platform-specific reporting caveats
