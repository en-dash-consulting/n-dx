---
id: "ff12092b-d386-46b4-b344-8ccf22a338ba"
level: "task"
title: "ndx init scaffolds a v2 project (product/index.md, never prd_tree/)"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "ad842166-7ac1-4875-bac8-e5f55ea18402"
source: "roadmap"
acceptanceCriteria:
  - "ndx init (and rex init) on a new project writes <rexDir>/product/index.md with schema rex/v2 and creates no prd_tree/"
  - "Re-running init on a v1 project leaves it on v1 (migration stays ndx migrate's job)"
  - "A fresh project prints no v1 deprecation notice"
  - "ndx work and rex next/update can work a task on the freshly initialized project, or init stays v1 until they can"
description: "Split out of ad842166, which delivered the ndx migrate chain and the v1 deprecation notice. Third criterion of ad842166 (\"ndx init creates a v2 project\"), moved here.\n\nWhy it did not land with ad842166 (checked 2026-10-12): a v2 tree is only partly workable. rex add, status, health, product, change, reshape/reorganize/prune and the MCP add/get tools dispatch on the layout; rex next, update, move, remove and hench's whole run path (resolveStore -> v1 FileStore through hench's rex-gateway) are v1-only. A fresh v2 project would therefore accept items that ndx work never sees. About 18 rex integration tests and many root e2e tests init a project and then use v1 levels (rex add epic ...), so they need a v1 fixture path (for example setupRexDir, or an explicit v1 opt-in) rather than init.\n\nShape: in packages/rex/src/cli/commands/init.ts replace the prd_tree/index.md stub with an empty v2 tree written by writePrdModel under withLock(prdLockPath(rexDir)) (model {layout: \"v2\", schema: SCHEMA_VERSION_V2, title: project, tree: {product: [], changes: []}, warnings: []}), only when neither prd_tree/ nor product/ exists; keep existing projects on their layout. Update the 'Next steps' lines to v2 verbs. Add init.ts to the v2 isolation allowlist in packages/rex/tests/unit/schema/v2.test.ts. Today a freshly initialized project is v1 and prints the deprecation notice from ad842166 on every rex command; this task removes that.\n\nBlocker to resolve first, outside this lane: hench (not in lane-migration) must select and complete tasks on a v2 change layer; see feature 20d12416 (Agent brief from the product layer) and the v2 store items."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:44:36.082Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
