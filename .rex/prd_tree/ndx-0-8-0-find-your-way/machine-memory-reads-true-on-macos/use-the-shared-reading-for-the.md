---
id: "7c5b3e53-be91-4368-a191-f97ef5ee7bda"
level: "task"
title: "Use the shared reading for the dashboard memory status and hub admission floor, labelled Available memory"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "macos-memory"
blockedBy:
  - "bd14ec22-f146-4315-bd90-e5d5c99d3284"
source: "GitHub issue en-dash-consulting/n-dx#497 (2026-10-01)"
acceptanceCriteria:
  - "GET /api/hench/memory with an injected darwin reading (os.freemem() 115 MB, availableBytes 3.9 GB of 16 GB, pressure normal) returns health \"healthy\", system.availableBytes ≈ 3.9 GB and system.freeBytes equal to availableBytes (today it returns critical at 99% used)."
  - "Pressure \"warn\" and \"critical\" map to health \"warning\" and \"critical\"."
  - "An unknown reading returns health \"unknown\" with freeBytes, usedBytes and usedPercent null, and the memory panel renders no warning or critical state."
  - "decideAdmission() with freeMemoryBytes null and a 2 GB floor admits; an AdmissionGate whose reading is unknown never queues for \"low-memory\" and reports memoryPaused false."
  - "On darwin, with os.freemem() at 115 MB but availableBytes 3.9 GB and a 2 GB floor, the hub admits the run (today it queues it)."
  - "For the same os.freemem() values on linux and win32, usedPercent, health and admission decisions are identical to today (existing routes-hench-memory and hub admission tests pass unchanged)."
  - "The memory panel and hub queue copy say \"available\" rather than \"free\"."
  - "A changeset bumps @n-dx/web (patch)."
description: "Depends on the llm-client shared available-memory reading. web imports it from @n-dx/llm-client directly, as other server files already do.\n\npackages/web/src/server/routes-hench.ts collectMemoryStatus(): use getAvailableMemory() (sync, cached — never block a request on a spawn) instead of os.freemem(). Keep the existing fields and add new ones: system gains availableBytes, pressure and source. When the reading is known, system.freeBytes carries availableBytes and usedPercent is computed from it; when unknown, freeBytes, usedBytes and usedPercent are null. health follows the reading's pressure: normal -> healthy, warn -> warning, critical -> critical, unknown -> a new \"unknown\" level. startMemoryMonitor() warms the cache at server start; executionMetrics.recordSnapshot skips systemMemoryPercent when unknown.\n\npackages/web/src/hub/admission.ts: the default freeMemory source is the shared reading's availableBytes (number | null); AdmissionSnapshot.freeMemoryBytes becomes number | null; decideAdmission() never returns \"low-memory\" for null, and memoryPaused is false then. Expose availableBytes and pressure on the queue snapshot (packages/web/src/hub/hub.ts, routes.ts) alongside freeMemoryBytes. Warm the cache when the hub starts.\n\nViewer: packages/web/src/viewer/components/memory-panel.ts label \"free\" -> \"available\"; an unknown reading renders an em dash and \"Memory reading unavailable\" with no warning or critical styling. packages/web/src/viewer/hooks/use-hub-queue.ts and views/workspaces.ts: \"free memory\" copy -> \"available memory\", null-safe. Add a changeset: @n-dx/web patch.\n\nSequencing: run this task only after PR en-dash-consulting/n-dx#496 (feat/live-tab) has merged and origin/main has been merged into this branch. #496 extracts readSystemMemory() in packages/web/src/server/routes-hench.ts, which collectMemoryStatus() and routes-live.ts both call — back readSystemMemory() with getAvailableMemory() rather than editing collectMemoryStatus() inline, so the dashboard status and /api/live share one reading. The Live tile itself is the next task."
lastModified: "2026-10-02T03:22:07.577Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
