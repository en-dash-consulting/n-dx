---
id: "2d502362-a88c-4ea6-b136-870f405fa914"
level: "task"
title: "restoreFromBackup and the backups listing refuse a v2 tree inside rex"
status: "pending"
priority: "high"
tags:
  - "pr-33"
  - "review-2026-10-12"
  - "lane-rex-store"
source: "review-2026-10-12"
acceptanceCriteria:
  - "restoreFromBackup on a copy of the v2 fixture with a v1 snapshot in .rex/.backups/ throws a v2 refusal with the wording of restore.ts:64, and creates no prd_tree/ (test that fails on 91865a3c2a)"
  - "getAvailableBackups on the same copy refuses the same way (test)"
  - "`rex restore` on v2 prints the same refusal as before; v1 restore and backup tests pass unedited"
description: "Review 2026-10-12, PR #687 should-fix added by the lead reviewer (CONFIRMED by reading), and the root cause of PR #693's must-fix.\n\nDefect: packages/rex/src/cli/commands/restore.ts:61-65 refuses on v2 (refuseOnV2: \"Restore is v1-only until after the v2 cut; recover a v2 tree from git history.\"), but restoreFromBackup (packages/rex/src/core/backup-snapshots.ts:299) and getAvailableBackups (:361) have no layout check, and both are public. restoreFromBackup rm's and renames <rexDir>/prd_tree from .rex/.backups/prd_tree_<id>/ unconditionally.\n\nFailure scenario: the dashboard's POST /api/rex/restore (packages/web/src/server/routes-rex/restore.ts:133) calls restoreFromBackup directly. On a v2 copy with .rex/.backups/prd_tree_2026-08-25T22-01-32.215Z/old-epic/index.md, GET /api/rex/backups lists the snapshot and POST /api/rex/restore answers 200; .rex/ then holds changes, prd_tree and product: a split tree. This repository's own checkout holds 7 prd_tree_* snapshots (gitignored, so ndx migrate leaves them), so after the cut one click splits the tree.\n\nFix: put the v2 refusal inside restoreFromBackup and getAvailableBackups (the backups listing), with the same wording as restore.ts:64, as a typed error a caller can recognise, so every caller (CLI, dashboard, anything later) inherits it. The CLI keeps its up-front refusal (or relies on the shared one) with unchanged output. The dashboard route test is D1-1 in PR 36."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:13:11.398Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
