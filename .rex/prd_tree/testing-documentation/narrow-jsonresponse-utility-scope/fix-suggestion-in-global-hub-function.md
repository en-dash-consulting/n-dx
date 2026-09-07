---
id: "d99f1ed5-40c7-4709-8f89-aceeb7ee3231"
level: "task"
title: "Fix suggestion in global: Hub function: jsonResponse in packages/web/src/server/response-utils.ts is calle"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-16T20:18:40.981Z"
completedAt: "2026-04-16T20:25:18.949Z"
resolutionType: "code-change"
resolutionDetail: "Made errorResponse delegate to jsonResponse (fixes missing Cache-Control header). Added SourcevisionScopeViewId/buildValidViews to external.ts gateway and routed two direct shared/view-routing.js imports through it. Added response-utils.test.ts (8 tests)."
acceptanceCriteria: []
description: "- Hub function: jsonResponse in packages/web/src/server/response-utils.ts is called from 22 files — changes here have wide impact, consider if responsibilities can be narrowed"
recommendationMeta: "[object Object]"
---
