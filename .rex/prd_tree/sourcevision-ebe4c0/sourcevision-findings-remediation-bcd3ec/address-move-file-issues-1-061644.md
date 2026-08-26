---
id: "06164479-3023-4d63-9026-4c50bed97883"
level: "task"
title: "Address move-file issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T14:06:42.747Z"
completedAt: "2026-03-11T14:10:10.559Z"
resolutionType: "code-change"
resolutionDetail: "Fixed majorityDirectory() to filter non-source files (images, config, build scripts) when computing zone directory majority, preventing false move-file recommendations caused by Louvain artifact files inflating package root counts."
acceptanceCriteria: []
description: "- File \"packages/web/src/viewer/messaging/call-rate-limiter.ts\" is pinned to zone \"Viewer Message Pipeline\" but lives in packages/web/src/viewer/messaging/ — consider moving to packages/web/ to align physical location with architectural zone"
recommendationMeta: "[object Object]"
---
