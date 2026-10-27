---
id: "a391ed1b-fc38-41a1-bd85-b0c5d3e8a014"
type: "task"
title: "Address pattern issues (1 findings)"
slug: "address-pattern-issues-1-findings-a391ed"
description: "- Redundancy cluster with highest recurrence: mcp-deps.ts @deprecated drift appears in global findings 9 (partial), 12, and 13 plus an indirect reference in finding 4 — four independent mentions, the most of any single issue. Concrete resolution steps from finding 13: run grep -r 'mcp-deps' packages/web/src/ excluding packages/web/src/server/rex-gateway.ts and packages/web/src/server/domain-gateway.ts; if the result is empty, delete packages/web/src/server/mcp-deps.ts entirely and remove any barrel re-exports referencing it; if callers remain, add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on direct mcp-deps imports and names rex-gateway.ts and domain-gateway.ts as replacements. Completing this step closes findings 9, 12, and 13 simultaneously."
priority: "high"
source: "sourcevision"
---
