---
id: "31f3c63c-f33f-4b2c-88f1-59f3ae423072"
level: "feature"
title: "Fix code in web-server (1 finding)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:38:08.081Z"
completedAt: "2026-04-14T01:38:08.081Z"
acceptanceCriteria: []
description: "- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix code in web-server: server/types.ts exports runtime functions jsonResponse(), errorResponse(), and r](./fix-code-in-web-server-server-f6c7a6/index.md) | completed |
