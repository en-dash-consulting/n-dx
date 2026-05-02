---
id: "603cdd22-0d5a-45bc-b79f-d04f44194a2e"
level: "task"
title: "Address suggestion issues (1 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T01:38:39.126Z"
completedAt: "2026-03-08T01:39:03.059Z"
acceptanceCriteria: []
description: "- mcp-deps.ts deletion is unblocked: static analysis confirms zero runtime import callers in packages/web/src. Concrete steps: (1) delete packages/web/src/server/mcp-deps.ts, (2) update the @see JSDoc comment in packages/web/src/public.ts (lines 36–44) and packages/web/src/viewer/components/prd-tree/types.ts (line 13) to reference rex-gateway.ts and domain-gateway.ts instead, (3) add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on any future direct import of mcp-deps. This closes global findings 3, 4, and 5 together."
recommendationMeta: "[object Object]"
---

# Address suggestion issues (1 findings)

🟠 [completed]

## Summary

- mcp-deps.ts deletion is unblocked: static analysis confirms zero runtime import callers in packages/web/src. Concrete steps: (1) delete packages/web/src/server/mcp-deps.ts, (2) update the @see JSDoc comment in packages/web/src/public.ts (lines 36–44) and packages/web/src/viewer/components/prd-tree/types.ts (line 13) to reference rex-gateway.ts and domain-gateway.ts instead, (3) add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on any future direct import of mcp-deps. This closes global findings 3, 4, and 5 together.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T01:38:39.126Z
- **Completed:** 2026-03-08T01:39:03.059Z
- **Duration:** < 1m
