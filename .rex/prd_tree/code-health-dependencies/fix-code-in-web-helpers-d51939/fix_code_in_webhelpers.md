---
id: "d519390b-e500-4cff-a9ae-6cfb76c29b32"
level: "task"
title: "Fix code in web-helpers: getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/level"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-04-14T00:27:09.262Z"
completedAt: "2026-04-14T00:31:35.592Z"
acceptanceCriteria: []
description: "- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T00:31:35.774Z"
__parentDescription: "- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken."
__parentId: "4bc33a6b-3827-44e3-8e6d-154653c9b4c3"
__parentLevel: "feature"
__parentPriority: "critical"
__parentRecommendationMeta: "[object Object]"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-14T00:31:35.774Z"
__parentStatus: "completed"
__parentTitle: "Fix code in web-helpers (1 finding)"
recommendationMeta: "[object Object]"
---
