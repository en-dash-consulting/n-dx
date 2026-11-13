---
id: "65ef6e47-4648-47a7-acc3-1e89d3722f27"
type: "task"
title: "Protect files moved with plain mv during PRD rollback"
slug: "protect-files-moved-with-plain-mv"
description: "PR #1004 review comment https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4558509342 (pre-existing gap). When the agent moves a file with plain mv, porcelain shows ' D src/app.ts' and '?? .rex/changes/ch/app.ts'; the untracked target is classified PRD, listed in the default-Yes rollback prompt and removed with its post-move edits while src/app.ts stays deleted. Detect the pair (for example rename detection via git add -N in a temporary index) and keep it out of the revert."
acceptanceCriteria:
  - "An untracked PRD-side file that pairs with a deleted non-PRD path is neither listed for nor removed by the rollback."
  - "A test reproduces the plain-mv case through partitionDirtyPaths and revertChanges."
  - "The rollback prompt's rename wording is extended to cover moves made with plain mv."
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "6d52c3c5-2257-4e58-8c14-f6eaf3f9c63a"
---
