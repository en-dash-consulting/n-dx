---
id: "ef4a47f0-273c-4c99-ae0a-8902ca66802a"
level: "task"
title: "Address anti-pattern issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T19:35:17.229Z"
completedAt: "2026-03-09T19:37:43.886Z"
resolutionType: "code-change"
resolutionDetail: "Extracted 4 helper functions from analyzeZones: prepareScopeAndEdges, promoteSubAnalyses, computeMoveFindings, buildAnalyzeZonesResult. Reduces the god function from ~190 lines of inline logic to a clean orchestrator that delegates each phase to a named function."
acceptanceCriteria: []
description: "- God function: analyzeZones in packages/sourcevision/src/analyzers/zones.ts calls 32 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (1 findings)

🟠 [completed]

## Summary

- God function: analyzeZones in packages/sourcevision/src/analyzers/zones.ts calls 32 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-09T19:35:17.229Z
- **Completed:** 2026-03-09T19:37:43.886Z
- **Duration:** 2m
