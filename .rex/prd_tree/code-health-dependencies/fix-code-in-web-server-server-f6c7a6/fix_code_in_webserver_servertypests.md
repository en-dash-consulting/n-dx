---
id: "f6c7a659-5ffe-46b1-af46-1b77e398ac59"
level: "task"
title: "Fix code in web-server: server/types.ts exports runtime functions jsonResponse(), errorResponse(), and r"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:32:10.265Z"
completedAt: "2026-04-14T01:38:07.906Z"
acceptanceCriteria: []
description: "- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T01:38:08.081Z"
__parentDescription: "- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts."
__parentId: "31f3c63c-f33f-4b2c-88f1-59f3ae423072"
__parentLevel: "feature"
__parentPriority: "high"
__parentRecommendationMeta: "[object Object]"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-14T01:38:08.081Z"
__parentStatus: "completed"
__parentTitle: "Fix code in web-server (1 finding)"
recommendationMeta: "[object Object]"
---
