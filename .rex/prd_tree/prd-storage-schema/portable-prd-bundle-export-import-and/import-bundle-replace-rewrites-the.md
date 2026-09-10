---
id: "1d91975a-0682-4240-b749-a862d857d8eb"
level: "task"
title: "`import-bundle --replace` rewrites the tree with no snapshot, no archive batch"
status: "completed"
priority: "high"
tags:
  - "pr-review"
  - "severity:high"
  - "must-fix"
source: "pr-review"
startedAt: "2026-09-10T19:14:00.223Z"
completedAt: "2026-09-10T19:23:03.279Z"
endedAt: "2026-09-10T19:23:03.279Z"
acceptanceCriteria:
  - "cmdImportBundle calls ensureSnapshot before opening the transaction, in both merge and replace modes"
  - "A replace import can be undone with `rex restore`"
  - "--no-snapshot opts out with the standard warning"
  - "Test: replace-import a bundle, run restore, assert the prior tree is back"
description: "Verdict: must-fix (resolve before merge). Found in PR review of the portable-prd-bundle branch; verified against source at HEAD.\n\nFailure scenario: snapshot-guard.ts states every command rewriting .rex/prd_tree/ calls ensureSnapshot first, and eight commands honour it (add, move, remove, prune, reshape, fix, reorganize, migrate-slugs). cmdImportBundle (packages/rex/src/cli/commands/import-bundle.ts:152) opens store.withTransaction with no ensureSnapshot and no appendArchiveBatch. `rex import-bundle --in=stale.json --replace --yes` (the documented non-interactive form) deletes every local item with no rollback point — `rex restore` has nothing, and recovery depends on git, which fails on projects that gitignore .rex/prd_tree/.\n\nSolution: `await ensureSnapshot(rexDir, \"import-bundle\", flags)` before the transaction (signature verified drop-in at cli/snapshot-guard.ts:44 — brings the --no-snapshot opt-out and fail-closed Windows behaviour along). Optionally also appendArchiveBatch for discarded items on the replace path, matching prune/reorganize."
lastModified: "2026-09-10T19:23:03.305Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
