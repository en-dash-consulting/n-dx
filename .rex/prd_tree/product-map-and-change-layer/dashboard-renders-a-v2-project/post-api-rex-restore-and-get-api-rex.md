---
id: "13d09a74-ac02-490c-ace2-ba90d5b10774"
level: "task"
title: "POST /api/rex/restore and GET /api/rex/backups refuse on a v2 project"
status: "pending"
priority: "critical"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
source: "review-2026-10-12"
acceptanceCriteria:
  - "On a v2 copy with a v1 snapshot in .rex/.backups/, POST /api/rex/restore answers an error (409) with rex's refusal wording and no prd_tree/ appears (route test that fails on 4a7b64a8c8)"
  - "GET /api/rex/backups on that copy does not offer the snapshot for restore: a 409 or an empty list with the reason (route test)"
  - "v1 restore and backups routes are unchanged; existing route tests pass unedited"
description: "Review 2026-10-12, PR #693 must-fix (CONFIRMED live by the subagent and by the lead reviewer's reading).\n\nDefect: POST /api/rex/restore (packages/web/src/server/routes-rex/restore.ts:133, `await restoreFromBackup(ctx.rexDir, input.id)`) and GET /api/rex/backups (:72, getAvailableBackups) have no layout check. restoreFromBackup rm's and renames <rexDir>/prd_tree from .rex/.backups/prd_tree_<id>/. rex's CLI `rex restore` refuses on v2, but the dashboard route skips that guard.\n\nFailure scenario (reproduced): on a v2 copy with .rex/.backups/prd_tree_2026-08-25T22-01-32.215Z/old-epic/index.md added, GET /api/rex/backups listed the snapshot and POST /api/rex/restore {\"id\":\"2026-08-25T22-01-32.215Z\",\"confirmFiles\":1} answered 200 {\"ok\":true,...}; .rex/ then held changes, execution-log.jsonl, prd_tree and product. This repository's checkout holds 7 prd_tree_* snapshots (gitignored, so ndx migrate leaves them), so after the cut the Restore panel lists them and one click splits the tree.\n\nFix: rex now refuses inside restoreFromBackup and getAvailableBackups (A1 task 2d502362, merged up from PR 33). Both routes surface that refusal as a 409 with rex's wording (\"Restore is v1-only until after the v2 cut; recover a v2 tree from git history.\"), recognising rex's typed refusal through the rex gateway rather than re-checking the layout in web. GET /api/rex/backups may answer an empty list with the reason instead, if the viewer copes better; pick one and test it. Any /api field added or changed on v2 gets a soft-freeze line in .changeset/web-dashboard-renders-v2.md."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:23:46.473Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
