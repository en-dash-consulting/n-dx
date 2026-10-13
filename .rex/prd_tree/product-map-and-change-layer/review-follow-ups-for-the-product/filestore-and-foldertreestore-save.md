---
id: "fa92110f-7be1-483c-bd40-379efb673801"
level: "task"
title: "FileStore and FolderTreeStore save reports are relative to .ndx/, not the project root, on the .ndx/ layout"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review-2026-10-12"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On the .ndx/ layout, FileStore's takeSaveFileReport after a save lists paths starting with .ndx/rex/prd_tree/ (new test)"
  - "On the .ndx/ layout, FolderTreeStore's takeSaveFileReport after a save lists paths starting with .ndx/rex/prd_tree/ (new test)"
  - "Legacy .rex/ layout save reports are unchanged; existing tests pass unedited"
description: "Found by the adversarial review of b3ae06d2 (ChangeLayerStore save report). Verdict: out-of-scope, since it predates that change; worth fixing.\n\nDefect: FileStore (packages/rex/src/store/file-adapter.ts:374 and :640) and FolderTreeStore (packages/rex/src/store/folder-tree-store.ts:143) build their SaveFileReport against dirname(this.rexDir). On the .ndx/ layout rexDir is <root>/.ndx/rex, so dirname is the .ndx container. The paths come out as \"rex/prd_tree/...\", not \".ndx/rex/prd_tree/...\". The SaveFileReport contract says the paths are project-relative.\n\nScenario: a project on the .ndx/ layout with a v1 tree runs `ndx work`. hench's scopePrdPathsToReport (packages/hench/src/agent/lifecycle/shared.ts) keeps only paths starting with `${rexDirName}/prd_tree/` (\".ndx/rex/prd_tree/\"). Every report path is dropped, so the completion commit stages only tree-meta.json and leaves the task's index.md edits dirty and unattributed.\n\nReachability: any v1 project migrated to the .ndx/ layout (core migrate-layout). ChangeLayerStore already uses projectRootOf (fixed in the b3ae06d2 review).\n\nFix (recommended, cheap): use projectRootOf(this.rexDir) from @n-dx/llm-client, which rex already imports in store/project-config.ts. Add a test per store that copies a tree under <tmp>/.ndx/rex and asserts the report paths start with \".ndx/rex/\". Risk: none on the legacy layout, where projectRootOf equals dirname."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T03:42:48.804Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
