---
id: "31f3c63c-f33f-4b2c-88f1-59f3ae423072"
type: "change"
title: "Fix code in web-server (1 finding)"
slug: "fix-code-in-web-server-1-finding"
intent: "- server/types.ts exports runtime functions jsonResponse(), errorResponse(), and readBody() alongside type definitions. Every other *types.ts file in the monorepo (fix/types.ts, recommend/types.ts, search-types.ts, batch-types.ts) is pure TypeScript types. Callers importing these helpers from a types.ts file violate the naming convention and couple to a file they likely assume is compile-time erased. Extract the three functions to server/response-utils.ts."
touches:
  - "1797eb3e-8ef9-4148-80fe-966693dd4e97"
priority: "high"
source: "sourcevision"
---
