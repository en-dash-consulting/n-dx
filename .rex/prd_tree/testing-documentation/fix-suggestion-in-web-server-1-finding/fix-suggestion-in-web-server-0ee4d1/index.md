---
id: "0ee4d183-b49b-472f-aa63-b796165fc901"
level: "task"
title: "Fix suggestion in web-server: Zone \"Web Server\" (web-server) has critical risk (score: 0.67, cohesion: 0.33, c"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-16T20:51:51.246Z"
completedAt: "2026-04-16T21:08:47.209Z"
resolutionType: "acknowledgment"
resolutionDetail: "web-server zone dissolved into web-viewer in latest Louvain analysis (stability.reassignedFiles shows 30+ server files moved). Root cause: server files import from packages/web/src/shared/ (required by barrel-import policy), and shared/ is also imported by viewer files, creating a Louvain bridge that merges the communities. Actual server/viewer boundary is intact (boundary-check.test.ts passes). Fix: (1) documented viewer-ui-hub in CLAUDE.md fragility governance table as requested by sourcevision, (2) added web-server zone stability section explaining the dissolution pattern and recovery steps, (3) updated hints.md with zone structure guidance for future analyses, (4) corrected web-shared file count (3→5 files) in governance docs."
acceptanceCriteria: []
description: "- Zone \"Web Server\" (web-server) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development"
recommendationMeta: "[object Object]"
---

# Fix suggestion in web-server: Zone "Web Server" (web-server) has critical risk (score: 0.67, cohesion: 0.33, c

🟠 [completed]

## Summary

- Zone "Web Server" (web-server) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-16T20:51:51.246Z
- **Completed:** 2026-04-16T21:08:47.209Z
- **Duration:** 16m
