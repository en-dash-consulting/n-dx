---
id: "603cdd22-0d5a-45bc-b79f-d04f44194a2e"
type: "task"
title: "Address suggestion issues (1 findings)"
slug: "address-suggestion-issues-1-603cdd"
description: "- mcp-deps.ts deletion is unblocked: static analysis confirms zero runtime import callers in packages/web/src. Concrete steps: (1) delete packages/web/src/server/mcp-deps.ts, (2) update the @see JSDoc comment in packages/web/src/public.ts (lines 36–44) and packages/web/src/viewer/components/prd-tree/types.ts (line 13) to reference rex-gateway.ts and domain-gateway.ts instead, (3) add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on any future direct import of mcp-deps. This closes global findings 3, 4, and 5 together."
priority: "high"
source: "sourcevision"
---
