---
id: "a3c5239a-e9a2-4d92-bf19-50b1489e9b69"
level: "task"
title: "Update the memory docs to describe the shared available-memory reading"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "macos-memory"
  - "docs"
blockedBy:
  - "bd14ec22-f146-4315-bd90-e5d5c99d3284"
  - "f8d28f62-5d6f-42a4-9ec5-37fa3e4f4057"
source: "GitHub issue en-dash-consulting/n-dx#497; stale memory docs found after T4 (2026-10-02)"
startedAt: "2026-10-02T04:30:33.897Z"
acceptanceCriteria:
  - "docs/process/memory-os-behavior.md no longer says n-dx reads os.freemem() on macOS, or that os.freemem() returns MemFree on Linux; its macOS section names vm_stat free + inactive + speculative + purgeable and kern.memorystatus_vm_pressure_level (1/2/4 → normal/warn/critical)."
  - "The Platform Comparison Summary rows for Linux and macOS match packages/llm-client/src/system-memory.ts, and the macOS recommendation to raise delayThreshold is gone."
  - "The page states the unknown-reading rule: availableBytes null and pressure \"unknown\" when nothing can be read, and nothing flags, throttles or queues a run on it."
  - "The page names the consumers that share the one reading: hench's throttle and pre-spawn check, the dashboard memory status and /api/live, and the hub admission floor."
  - "docs/contributing/memory-system-improvements.md marks the macOS vm_stat improvement done and no longer shows an os.freemem() diagnostics strategy for darwin; docs/contributing/memory-system-risks.md marks risk 1 resolved."
  - "No files outside docs/ change, and `pnpm docs:build` (or the repo's VitePress build) succeeds with no new dead-link errors."
description: "The docs still describe the memory reading as it was before this feature. Bring three pages in line with the shared reading in packages/llm-client/src/system-memory.ts (read it first; it is the source of truth), and leave every other section alone.\n\ndocs/process/memory-os-behavior.md:\n- Linux: n-dx now takes os.freemem(), which reads MemAvailable from /proc/meminfo on libuv >= 1.45 (Node >= 22, the repo's engine floor) and falls back to MemFree only on kernels without MemAvailable (< 3.14). Replace the claim that os.freemem() = MemFree and the \"n-dx Implementation\" block that describes hench parsing /proc/meminfo itself.\n- macOS: \"n-dx Implementation\" and \"Practical Impact\" say n-dx uses os.freemem() and throttles early. Describe the real path: vm_stat free + inactive + speculative + purgeable pages x page size for availableBytes; kern.memorystatus_vm_pressure_level (1 normal, 2 warn, 4 critical) for pressure, which drives dashboard health; both run in parallel, cached 5 s, never awaited by a request; if neither can be read the reading is availableBytes null / pressure \"unknown\" and nothing flags, throttles or queues a run. Correct the quirks-table row that says memory pressure is not accessible from Node.js (it is read via sysctl).\n- Platform Comparison Summary table: fix the \"Free memory API\", \"n-dx reads\", \"Cache handling\" and \"Accuracy rating\" rows for Linux and macOS. Recommendations: drop the advice to raise delayThreshold on macOS.\n- Add a short section naming the one reading every consumer shares (hench MemoryThrottle and pre-spawn check, the dashboard memory status and /api/live, the hub admission floor) and the unknown-reading rule.\n\ndocs/contributing/memory-system-improvements.md: mark improvement 1 (macOS vm_stat) as done, with what shipped instead of the proposal (no fallback to os.freemem() on macOS: an unreadable machine is unknown), and update the priority table row and the diagnostics example that prints \"strategy: os.freemem() (inactive pages not included)\" for darwin.\n\ndocs/contributing/memory-system-risks.md: mark risk 1 (macOS reporting underestimates availability) as resolved, with one sentence on how.\n\nDocs only: no source or test changes, and no changeset (docs/ is not a published package). Check the VitePress build still resolves the pages' links."
lastModified: "2026-10-02T04:30:34.745Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
