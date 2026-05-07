---
id: "4fc913c5-82c4-4fb0-958f-ba5836822c0d"
level: "task"
title: "Fix code in rex: packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, "
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:14:16.214Z"
completedAt: "2026-04-14T01:20:10.484Z"
acceptanceCriteria: []
description: "- packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, core/stats, schema/index, recommend/conflict-detection, fix/index, and 30+ others) with no boundary assertion preventing the surface from expanding. public.ts exports ~30 symbols but CLI commands bypass it entirely, creating a de-facto second internal API that is invisible to external consumers and to domain-isolation.test.js. Adding a boundary assertion — 'cli/commands/ may only import from public.ts or core/ directly' — would cap growth of this surface and make the privileged-consumer pattern explicit."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-14T01:20:10.658Z"
__parentDescription: "- packages/rex/src/cli/commands/ imports from 40+ internal submodules (core/tree, core/stats, schema/index, recommend/conflict-detection, fix/index, and 30+ others) with no boundary assertion preventing the surface from expanding. public.ts exports ~30 symbols but CLI commands bypass it entirely, creating a de-facto second internal API that is invisible to external consumers and to domain-isolation.test.js. Adding a boundary assertion — 'cli/commands/ may only import from public.ts or core/ directly' — would cap growth of this surface and make the privileged-consumer pattern explicit."
__parentId: "3fecf45d-371c-4772-969f-203383f29f7e"
__parentLevel: "feature"
__parentPriority: "high"
__parentRecommendationMeta: "[object Object]"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-14T01:20:10.658Z"
__parentStatus: "completed"
__parentTitle: "Fix code in rex (1 finding)"
recommendationMeta: "[object Object]"
---
