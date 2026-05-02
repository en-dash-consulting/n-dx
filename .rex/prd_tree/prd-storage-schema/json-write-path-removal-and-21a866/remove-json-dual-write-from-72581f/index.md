---
id: "72581f11-f8ee-46fd-8e2f-60bf6055850e"
level: "task"
title: "Remove JSON dual-write from PRDStore save operations"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "prd-storage"
  - "cleanup"
  - "prd"
  - "storage"
source: "smart-add"
startedAt: "2026-04-29T02:16:51.764Z"
completedAt: "2026-04-29T13:57:27.832Z"
endedAt: "2026-04-29T13:57:27.832Z"
resolutionType: "code-change"
resolutionDetail: "Dual-write was already removed in commit 348f2f9c. Updated test fixtures to seed prd.md and added 5 regression tests asserting saveDocument/addItem never create or modify prd.json."
acceptanceCriteria:
  - "PRDStore.saveDocument() writes only to .rex/prd.md and branch-scoped .rex/prd_*.md files — no .rex/prd.json"
  - "No method on PRDStore creates or modifies .rex/prd.json"
  - "Running ndx add on a project with no pre-existing prd.json does not create one"
  - "Running ndx add on a project with a pre-existing prd.json does not modify it"
  - "All existing PRDStore unit tests pass with the JSON write path removed"
  - "PRDStore.saveDocument writes only to the folder-tree; prd.md is not created or updated on any mutation"
  - "Branch-scoped prd_{branch}_{date}.md files are also never written by the store"
  - "Existing unit tests for saveDocument pass against the folder-tree-only backend"
  - "A regression test confirms prd.md does not exist after add, edit, remove, move, and merge operations"
description: "Update PRDStore.saveDocument (and any dual-write helpers) to write exclusively to the folder-tree structure. Remove any conditional that writes or syncs to prd.md or branch-scoped prd_{branch}_{date}.md files. The folder-tree must be the only write target for all PRD mutations so that prd.md is never created or updated by normal operation."
---

# Remove JSON dual-write from PRDStore save operations

🔴 [completed]

## Summary

Update PRDStore.saveDocument (and any dual-write helpers) to write exclusively to the folder-tree structure. Remove any conditional that writes or syncs to prd.md or branch-scoped prd_{branch}_{date}.md files. The folder-tree must be the only write target for all PRD mutations so that prd.md is never created or updated by normal operation.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** rex, prd-storage, cleanup, prd, storage
- **Level:** task
- **Started:** 2026-04-29T02:16:51.764Z
- **Completed:** 2026-04-29T13:57:27.832Z
- **Duration:** 11h 40m
