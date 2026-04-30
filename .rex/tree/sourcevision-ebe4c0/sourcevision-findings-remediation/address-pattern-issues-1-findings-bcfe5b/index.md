---
id: "bcfe5bdf-685d-4be4-b581-581055424544"
level: "task"
title: "Address pattern issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T19:46:05.569Z"
completedAt: "2026-03-09T19:54:29.822Z"
resolutionType: "code-change"
resolutionDetail: "Created viewer external gateway (external.ts) to funnel all cross-boundary imports through a single file. Updated 19 viewer files. Added boundary enforcement test. Pinned 5 stray viewer files to web-viewer zone."
acceptanceCriteria: []
description: "- Three distinct web package zones (web at 0.67, web-server at 0.60, crash at 0.71) each independently show high coupling to web-viewer, and global-0 records 13+9=22 bidirectional crossings. All four findings share the single root cause: no barrel export or import boundary exists for packages/web/src/viewer/. Web-viewer finding 4 (LLM pass) already identifies the fix. Scheduling these as four separate refactoring items misattributes scope — they are one gap with one fix."
recommendationMeta: "[object Object]"
---

# Address pattern issues (1 findings)

🟠 [completed]

## Summary

- Three distinct web package zones (web at 0.67, web-server at 0.60, crash at 0.71) each independently show high coupling to web-viewer, and global-0 records 13+9=22 bidirectional crossings. All four findings share the single root cause: no barrel export or import boundary exists for packages/web/src/viewer/. Web-viewer finding 4 (LLM pass) already identifies the fix. Scheduling these as four separate refactoring items misattributes scope — they are one gap with one fix.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-09T19:46:05.569Z
- **Completed:** 2026-03-09T19:54:29.822Z
- **Duration:** 8m
