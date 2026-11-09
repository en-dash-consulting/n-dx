---
id: "93e250fe-f38b-4783-bc59-2996e83b7b5a"
type: "task"
title: "A change on a fresh v2 project can leave the Inbox, so ndx work and rex next select work there"
slug: "a-change-on-a-fresh-v2-project-can"
description: "Found while doing ff12092b (2026-10-15) and blocks it: its fourth criterion says init stays v1 until this works.\n\nReproduced on an empty v2 tree (product/index.md only, written by writePrdModel): `rex add --title=X` and `rex add task --parent=X` succeed, and the change lands in the Inbox with needsPlacement. Autonomous selection (core/change-selection.ts findActionableWork) skips Inbox changes, so `rex next` prints COMPLETE and `ndx work` finds nothing. Placement needs a capability or constraint target (`rex change place --target`). An `added` amendment needs `under` an existing area or capability (core/apply-amendments.ts applyAdded). No CLI verb, MCP tool or amendment creates an area. So nothing on an empty product layer can ever leave the Inbox. Only `ndx work --task=<id>` (resolveWorkById) and `rex update` reach it.\n\nDecided by Ryan, 2026-10-15: option (b). When the product layer has no capability and no constraint, there is nowhere to place a change, so an Inbox change is not held for placement there: autonomous selection (core/change-selection.ts) takes it and its tasks, and closing (core/change-completion.ts closeChange) completes it instead of holding it with \"still needs placement\". As soon as the product layer has a capability or constraint, the existing rules apply unchanged. Rejected: (a) a new verb or rootless added amendment that creates the first area (new CLI/MCP surface), and (c) init seeding a root area (placement still needs a capability, so it would also need a placeholder one). Keep it minimal: the one empty-product condition shared by both rules, no new surface, no placeholder content. Bootstrapping a product layer stays after the cut (3f1ff1cf). Then ff12092b can land.\n\nff12092b's init change was written and reverted, about 25 lines: in cli/commands/init.ts, scaffoldPrd(rexDir, project) writes {layout:\"v2\", schema:SCHEMA_VERSION_V2, title, tree:{product:[],changes:[]}, warnings:[]} through withLock(prdLockPath(rexDir), () => writePrdModel(...)) when !rexDirHoldsPrd(rexDir); prints v2 next steps (`rex add --title=...`, `rex product show`) whenever the tree is v2. Verified: it writes only product/index.md, and status, add, health and validate work on the result."
acceptanceCriteria:
  - "On a project whose product layer has no capability and no constraint, a change added with rex add (and its tasks) is selected by rex next and ndx work, and the change completes when its last task does, without placement"
  - "Once the product layer has a capability or constraint, Inbox changes are held from selection and from closing exactly as before"
  - "The path is covered by a rex integration test that starts from an empty v2 tree, adds a change with a task, selects it and completes it"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-work run 29014705"
---
