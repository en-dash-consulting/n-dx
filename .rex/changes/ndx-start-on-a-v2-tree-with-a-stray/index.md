---
id: "553621c0-4ccc-40a6-9ea1-c4e5b40b002e"
type: "change"
title: "ndx start on a v2 tree with a stray prd.json creates no prd_tree/"
slug: "ndx-start-on-a-v2-tree-with-a-stray"
intent: "Review 2026-10-12, PR #693 should-fix 3 (CONFIRMED with rex dist on a v2 copy plus .rex/prd.json: ensureLegacyPrdMigrated returned migrated: true, folderTreePath: '.rex/prd_tree', and the tree then held prd_tree + product + changes). The rex fix is A1's d1dc7f68 (PR 33), merged up here.\n\nDefect: packages/web/src/server/start.ts:1118 calls ensureLegacyPrdMigrated unconditionally at startup, so `ndx start` on a v2 tree with a stray prd.json scaffolded prd_tree/ beside product/.\n\nFix: confirm that with d1dc7f68 merged, starting the server on a v2 copy holding a same-id prd.json creates no prd_tree/ and serves the v2 titles from /api/rex/prd, and pin it with a web test. Change start.ts only if the test shows the rex fix does not cover this path (for example, a skip on prdLayout === \"v2\", which the gateway already exports)."
acceptanceCriteria:
  - "Starting the web server on a v2 copy holding a same-id .rex/prd.json creates no prd_tree/, and /api/rex/prd serves the v2 titles (web test that fails on 4a7b64a8c8)"
  - "start.ts is changed only if the test shows d1dc7f68's rex fix does not cover the startup path"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "high"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
source: "review-2026-10-12"
blockedBy:
  - "d1dc7f68-d08f-4377-a30a-0394a135bc62"
---
