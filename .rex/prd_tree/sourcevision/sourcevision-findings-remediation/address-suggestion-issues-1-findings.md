---
id: "0ef1785a-19c8-47ad-86e0-e7e385663165"
level: "task"
title: "Address suggestion issues (1 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-07T03:15:43.155Z"
completedAt: "2026-03-07T03:18:36.592Z"
acceptanceCriteria: []
description: "- Zone \"Crash Recovery\" (crash-recovery) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention\n\n---\n\n- mcp-deps.ts deletion is unblocked: static analysis confirms zero runtime import callers in packages/web/src. Concrete steps: (1) delete packages/web/src/server/mcp-deps.ts, (2) update the @see JSDoc comment in packages/web/src/public.ts (lines 36–44) and packages/web/src/viewer/components/prd-tree/types.ts (line 13) to reference rex-gateway.ts and domain-gateway.ts instead, (3) add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on any future direct import of mcp-deps. This closes global findings 3, 4, and 5 together.\n\n---\n\n- Zone \"Schema Validation\" (packages-rex:schema-validation) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention"
recommendationMeta: "[object Object]"
---
