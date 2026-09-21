---
id: "cd8060d7-e028-48f1-9843-deea23eabeed"
level: "task"
title: "Decide and document the Windows available-memory strategy for hench admission"
status: "completed"
priority: "low"
tags:
  - "cross-os"
  - "windows"
  - "hench"
  - "memory"
  - "investigate"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T14:33:38.632Z"
completedAt: "2026-08-19T14:40:41.511Z"
endedAt: "2026-08-19T14:40:41.511Z"
acceptanceCriteria:
  - "A measurement on real Windows hardware comparing os.freemem() against a standby-inclusive available-memory figure under load"
  - "A recorded decision: implement a Windows-specific reader, or accept the fallback with the reasoning documented in the module JSDoc"
  - "IF implemented: the reader goes through the existing MemoryMonitorOverrides seam, is cached so no process spawn occurs per tool call, and is invoked via win-spawn.js"
  - "IF implemented: wmic is avoided in favor of a PowerShell CIM or performance-counter query, given wmic's deprecation and absence on newer Windows"
  - "No change to Linux or macOS readings"
description: "INVESTIGATE-AND-DECIDE, not necessarily implement. Filed because the asymmetry is real and undocumented as a *decision*, but it may well be acceptable as-is.\n\npackages/hench/src/process/memory-monitor.ts:303-325 `snapshot()` resolves availableBytes per platform:\n- linux → `/proc/meminfo` MemAvailable (accounts for reclaimable buffers/cache)\n- darwin → vm_stat-derived reader\n- everything else, including win32 → falls back to raw `os.freemem()`\n\nOn Windows `os.freemem()` maps to GlobalMemoryStatusEx ullAvailPhys, which counts only free physical memory and EXCLUDES the standby/cached list that Windows would reclaim on demand. So for identical real machine conditions, Windows reports a lower available figure than Linux's MemAvailable, and usagePercent runs correspondingly higher. Because SystemMemoryMonitor backs MemoryThrottle (the run-admission gate) and checkBeforeSpawn (the per-tool-call gate), the practical effect is that hench delays or rejects work more readily on Windows than on macOS/Linux on comparable hardware.\n\nFIRST establish whether this matters in practice before building anything: measure os.freemem() against the standby-inclusive figure on a real Windows box under load (Get-Counter '\\Memory\\Available MBytes', which includes standby, is the closest analog to MemAvailable) and compare the resulting throttle decisions against the configured threshold. If the gap does not move decisions at realistic thresholds, the correct outcome is to document the fallback as an accepted limitation in the JSDoc and close this.\n\nIF it does move decisions, options in rough preference order: read `\\Memory\\Available MBytes` via a performance-counter query; or `wmic OS get FreePhysicalMemory` (note wmic is deprecated and absent on newer Windows images, so prefer a PowerShell CIM query); either routed through win-spawn.js and cached, since this sits on the per-tool-call hot path and must not add a process spawn per tool call. The existing MemoryMonitorOverrides interface already provides the seam for a readWindowsAvailable injection point, mirroring the linux/darwin readers.\n\nThe module JSDoc currently states the Windows behavior factually (\":22 uses os.freemem()\"), so this is an unexamined default rather than a documentation bug — the deliverable is a recorded decision either way."
---
