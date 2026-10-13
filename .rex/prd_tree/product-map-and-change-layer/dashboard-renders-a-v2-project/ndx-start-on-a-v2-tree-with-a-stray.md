---
id: "553621c0-4ccc-40a6-9ea1-c4e5b40b002e"
level: "task"
title: "ndx start on a v2 tree with a stray prd.json creates no prd_tree/"
status: "completed"
priority: "high"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
blockedBy:
  - "d1dc7f68-d08f-4377-a30a-0394a135bc62"
source: "review-2026-10-12"
startedAt: "2026-10-13T16:43:43.777Z"
completedAt: "2026-10-13T16:47:12.195Z"
endedAt: "2026-10-13T16:47:12.195Z"
resolutionType: "code-change"
resolutionDetail: "Rex fix d1dc7f68 covers the startup path; added web test pinning it. start.ts unchanged."
acceptanceCriteria:
  - "Starting the web server on a v2 copy holding a same-id .rex/prd.json creates no prd_tree/, and /api/rex/prd serves the v2 titles (web test that fails on 4a7b64a8c8)"
  - "start.ts is changed only if the test shows d1dc7f68's rex fix does not cover the startup path"
description: "Review 2026-10-12, PR #693 should-fix 3 (CONFIRMED with rex dist on a v2 copy plus .rex/prd.json: ensureLegacyPrdMigrated returned migrated: true, folderTreePath: '.rex/prd_tree', and the tree then held prd_tree + product + changes). The rex fix is A1's d1dc7f68 (PR 33), merged up here.\n\nDefect: packages/web/src/server/start.ts:1118 calls ensureLegacyPrdMigrated unconditionally at startup, so `ndx start` on a v2 tree with a stray prd.json scaffolded prd_tree/ beside product/.\n\nFix: confirm that with d1dc7f68 merged, starting the server on a v2 copy holding a same-id prd.json creates no prd_tree/ and serves the v2 titles from /api/rex/prd, and pin it with a web test. Change start.ts only if the test shows the rex fix does not cover this path (for example, a skip on prdLayout === \"v2\", which the gateway already exports)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T16:47:12.479Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
