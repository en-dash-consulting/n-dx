---
id: "3fecf45d-371c-4772-969f-203383f29f7e"
level: "feature"
title: "Fix code in rex (1 finding)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:20:10.658Z"
completedAt: "2026-04-14T01:20:10.658Z"
acceptanceCriteria: []
description: "- packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, core/stats, schema/index, recommend/conflict-detection, fix/index, and 30+ others) with no boundary assertion preventing the surface from expanding. public.ts exports ~30 symbols but CLI commands bypass it entirely, creating a de-facto second internal API that is invisible to external consumers and to domain-isolation.test.js. Adding a boundary assertion — 'cli/commands/ may only import from public.ts or core/ directly' — would cap growth of this surface and make the privileged-consumer pattern explicit."
recommendationMeta: "[object Object]"
---

# Fix code in rex (1 finding)

🟠 [completed]

## Summary

- packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, core/stats, schema/index, recommend/conflict-detection, fix/index, and 30+ others) with no boundary assertion preventing the surface from expanding. public.ts exports ~30 symbols but CLI commands bypass it entirely, creating a de-facto second internal API that is invisible to external consumers and to domain-isolation.test.js. Adding a boundary assertion — 'cli/commands/ may only import from public.ts or core/ directly' — would cap growth of this surface and make the privileged-consumer pattern explicit.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix code in rex: packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree,  | task | completed | 2026-04-14 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-14T01:20:10.658Z
- **Completed:** 2026-04-14T01:20:10.658Z
- **Duration:** < 1m
