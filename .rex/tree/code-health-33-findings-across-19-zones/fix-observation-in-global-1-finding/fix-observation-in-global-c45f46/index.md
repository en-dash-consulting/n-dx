---
id: "c45f46d8-4b11-465d-a5ce-b3ca071ae2aa"
level: "task"
title: "Fix observation in global: Bidirectional coupling: \"viewer-ui-hub\" ↔ \"web-viewer\" (5+5 crossings) — conside"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-17T15:33:07.453Z"
completedAt: "2026-04-17T15:47:26.536Z"
resolutionType: "code-change"
resolutionDetail: "Extended api.ts with hooks/component/nav re-exports; sidebar.ts now imports through api.ts instead of 4 direct web-viewer leaf files, reducing outbound zone crossings from 5 targets to 2 (external.ts + api.ts)"
acceptanceCriteria: []
description: "- Bidirectional coupling: \"viewer-ui-hub\" ↔ \"web-viewer\" (5+5 crossings) — consider extracting shared interface"
recommendationMeta: "[object Object]"
---

# Fix observation in global: Bidirectional coupling: "viewer-ui-hub" ↔ "web-viewer" (5+5 crossings) — conside

🟠 [completed]

## Summary

- Bidirectional coupling: "viewer-ui-hub" ↔ "web-viewer" (5+5 crossings) — consider extracting shared interface

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-17T15:33:07.453Z
- **Completed:** 2026-04-17T15:47:26.536Z
- **Duration:** 14m
