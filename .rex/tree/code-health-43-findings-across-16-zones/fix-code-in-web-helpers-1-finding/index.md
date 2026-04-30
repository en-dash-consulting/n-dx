---
id: "4bc33a6b-3827-44e3-8e6d-154653c9b4c3"
level: "feature"
title: "Fix code in web-helpers (1 finding)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-04-14T00:31:35.774Z"
completedAt: "2026-04-14T00:31:35.774Z"
acceptanceCriteria: []
description: "- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken."
recommendationMeta: "[object Object]"
---

# Fix code in web-helpers (1 finding)

🔴 [completed]

## Summary

- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix code in web-helpers: getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/level | task | completed | 2026-04-14 |

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** feature
- **Started:** 2026-04-14T00:31:35.774Z
- **Completed:** 2026-04-14T00:31:35.774Z
- **Duration:** < 1m
