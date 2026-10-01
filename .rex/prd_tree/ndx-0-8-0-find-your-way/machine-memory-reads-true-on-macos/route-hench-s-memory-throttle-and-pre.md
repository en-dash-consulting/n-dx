---
id: "d3adb680-9f9a-47ae-ae65-b327028ffd91"
level: "task"
title: "Route hench's memory throttle and pre-spawn check through the shared reading and never act on an unknown reading"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "macos-memory"
blockedBy:
  - "bd14ec22-f146-4315-bd90-e5d5c99d3284"
source: "GitHub issue en-dash-consulting/n-dx#497 (2026-10-01)"
acceptanceCriteria:
  - "On darwin, with os.freemem() at 115 MB of 16 GB but the shared reading at 3.9 GB available, MemoryThrottle.gate() allows the run (today it reads os.freemem() and rejects at ~99% used)."
  - "With an unknown reading and rejectThreshold 1 / delayThreshold 0, MemoryThrottle.gate() allows without invoking the delay callback."
  - "SystemMemoryMonitor.checkBeforeSpawn() on an unknown reading returns allowed: true, so dispatchTool emits no [MEMORY] block; it never falls back to os.freemem() on darwin."
  - "An unknown reading records memoryStats systemAvailable*Bytes as -1 and the end-of-run line reports available memory as unknown."
  - "Existing Linux and Windows memory-monitor and memory-throttle tests pass unchanged."
  - "The llm-gateway export cap in tests/e2e/architecture-policy.test.js is raised with a documented reason, and tests/e2e/domain-isolation.test.js passes (hench imports the reading only through src/prd/llm-gateway.ts)."
  - "A changeset bumps @n-dx/hench (patch)."
description: "Depends on the llm-client shared available-memory reading. Re-export readAvailableMemory, getAvailableMemory and the AvailableMemoryReading type through packages/hench/src/prd/llm-gateway.ts (the only hench import path for @n-dx/llm-client) and raise its cap in tests/e2e/architecture-policy.test.js (BOUNDARY_FILES, currently 181) with the reason in the description: the available-memory reading is one decision shared with the dashboard and hub, and a hench-local reader is how hench and the dashboard came to disagree.\n\npackages/hench/src/process/memory-monitor.ts: snapshot() uses the shared reading; remove the hench-local readLinuxAvailableMemory / readDarwinAvailableMemory and the os.freemem() fallback on Darwin; keep the Windows docblock decision. availableBytes and usagePercent become nullable; checkBeforeSpawn() returns allowed: true when the reading is unknown. Fix the module docblock line that says macOS uses os.freemem().\n\npackages/hench/src/process/memory-throttle.ts: the default reader is the shared reading (await readAvailableMemory() in gate()/status) instead of os.freemem(); an unknown reading decides \"allow\" regardless of thresholds. packages/hench/src/tools/dispatch.ts keeps calling checkBeforeSpawn (now cached, so not one vm_stat per tool call).\n\npackages/hench/src/agent/lifecycle/shared.ts: run-start/run-end memoryStats record -1 for an unknown reading, and the end-of-run \"system: X / Y GB available\" line says unknown instead of a number. Add a changeset: @n-dx/hench patch."
lastModified: "2026-10-01T23:05:19.200Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
