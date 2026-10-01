---
id: "bd14ec22-f146-4315-bd90-e5d5c99d3284"
level: "task"
title: "Add a shared available-memory reading to llm-client that counts macOS reclaimable pages and kernel pressure"
status: "in_progress"
priority: "high"
tags:
  - "0.8.0"
  - "macos-memory"
source: "GitHub issue en-dash-consulting/n-dx#497 (2026-10-01)"
startedAt: "2026-10-01T23:29:16.755Z"
acceptanceCriteria:
  - "A Darwin parser test fed recorded vm_stat output from a 16 GB machine (page size 16384, Pages free 19259 ≈ 315 MB, Pages inactive 225312 ≈ 3.6 GB, plus small speculative and purgeable counts) and sysctl output \"1\" returns availableBytes ≈ 3.9 GB (within 1%), pressure \"normal\", and a darwin vm_stat source."
  - "Sysctl pressure output \"2\" maps to \"warn\" and \"4\" maps to \"critical\"."
  - "When the vm_stat and sysctl commands both fail (ENOENT, EPERM or timeout), the reading is availableBytes null and pressure \"unknown\", and the call does not throw."
  - "Unparseable vm_stat output yields availableBytes null — never 0 and never the os.freemem() value."
  - "On linux and win32 the reading's availableBytes equals os.freemem() exactly and pressure follows the 75% / 90% used thresholds, so Linux and Windows readings are unchanged."
  - "Two reads within the cache TTL run the commands once, concurrent refreshes share one spawn, and getAvailableMemory() returns synchronously without awaiting a spawn (returns unknown/pending before the first reading)."
  - "A changeset bumps @n-dx/llm-client (patch)."
description: "Add packages/llm-client/src/system-memory.ts and export it from packages/llm-client/src/public.ts. readAvailableMemory(): Promise<AvailableMemoryReading> and getAvailableMemory(): AvailableMemoryReading (sync: returns the cached reading and starts a background refresh; never awaits a spawn). Reading shape: { availableBytes: number | null, totalBytes: number, pressure: \"normal\" | \"warn\" | \"critical\" | \"unknown\", source: string }.\n\nDarwin: run `vm_stat` and `sysctl -n kern.memorystatus_vm_pressure_level` in parallel via execFile (timeout ~1.5 s). availableBytes = (Pages free + Pages inactive + Pages speculative + Pages purgeable) x page size parsed from the vm_stat header. Pressure 1 -> normal, 2 -> warn, 4 -> critical. If vm_stat fails or its output lacks the page-size header or the \"Pages free\" line, availableBytes is null (never 0, never the os.freemem() value); if the sysctl also fails, pressure is \"unknown\". If only the sysctl fails, derive pressure from available% with the thresholds below.\n\nLinux and win32: availableBytes = os.freemem() (MemAvailable on Linux via libuv >= 1.45, ullAvailPhys on Windows — see the docblock in packages/hench/src/process/memory-monitor.ts); pressure derived from used% = (total - available) / total: >= 90 critical, >= 75 warn, else normal (the same thresholds as computeMemoryHealth in packages/web/src/server/routes-hench.ts).\n\nCache the reading for 5 s; concurrent refreshes share one in-flight spawn. Before the first reading completes, getAvailableMemory() returns { availableBytes: null, pressure: \"unknown\", source: \"pending\" }. Provide an injection seam (platform, exec runner, freemem/totalmem, clock) for tests; parse functions are pure and exported for testing. Add a changeset: @n-dx/llm-client patch."
lastModified: "2026-10-01T23:29:18.480Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
