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
recommendationMeta: "[object Object]"
---

# Fix code in web-server: server/types.ts exports runtime functions jsonResponse(), errorResponse(), and r

🟠 [completed]

## Summary

- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-14T01:32:10.265Z
- **Completed:** 2026-04-14T01:38:07.906Z
- **Duration:** 5m
