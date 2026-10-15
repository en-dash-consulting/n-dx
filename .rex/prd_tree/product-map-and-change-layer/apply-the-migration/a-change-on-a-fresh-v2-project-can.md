---
id: "93e250fe-f38b-4783-bc59-2996e83b7b5a"
level: "task"
title: "A change on a fresh v2 project can leave the Inbox, so ndx work and rex next select work there"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-work run 29014705"
acceptanceCriteria:
  - "On a project whose product layer is empty, a change added with rex add can be selected by rex next and ndx work, after at most a documented CLI step"
  - "The path is covered by a rex integration test that starts from an empty v2 tree"
description: "Found while doing ff12092b (2026-10-15) and blocks it: its fourth criterion says init stays v1 until this works.\n\nReproduced on an empty v2 tree (product/index.md only, written by writePrdModel): `rex add --title=X` and `rex add task --parent=X` succeed, and the change lands in the Inbox with needsPlacement. Autonomous selection (core/change-selection.ts findActionableWork) skips Inbox changes, so `rex next` prints COMPLETE and `ndx work` finds nothing. Placement needs a capability or constraint target (`rex change place --target`). An `added` amendment needs `under` an existing area or capability (core/apply-amendments.ts applyAdded). No CLI verb, MCP tool or amendment creates an area. So nothing on an empty product layer can ever leave the Inbox. Only `ndx work --task=<id>` (resolveWorkById) and `rex update` reach it.\n\nPick one, a product decision: (a) a way to create the first area or capability (a `rex product add` verb, or an `added` amendment with no `under` that creates a root area); (b) selection takes Inbox changes when the product layer has no capability or constraint to place them on; (c) init seeds a root area. Then ff12092b can land.\n\nff12092b's init change was written and reverted, about 25 lines: in cli/commands/init.ts, scaffoldPrd(rexDir, project) writes {layout:\"v2\", schema:SCHEMA_VERSION_V2, title, tree:{product:[],changes:[]}, warnings:[]} through withLock(prdLockPath(rexDir), () => writePrdModel(...)) when !rexDirHoldsPrd(rexDir); prints v2 next steps (`rex add --title=...`, `rex product show`) whenever the tree is v2. Verified: it writes only product/index.md, and status, add, health and validate work on the result."
lastModified: "2026-10-15T05:35:13.498Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
