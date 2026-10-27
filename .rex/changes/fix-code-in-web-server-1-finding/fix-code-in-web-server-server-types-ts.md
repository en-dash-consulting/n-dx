---
id: "f6c7a659-5ffe-46b1-af46-1b77e398ac59"
type: "task"
title: "Fix code in web-server: server/types.ts exports runtime functions jsonResponse(), errorResponse(), and r"
slug: "fix-code-in-web-server-server-types-ts"
description: "- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts."
priority: "high"
source: "sourcevision"
---
