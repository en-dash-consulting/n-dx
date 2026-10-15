---
id: "fa92110f-7be1-483c-bd40-379efb673801"
level: "task"
title: "FileStore and FolderTreeStore save reports are relative to .ndx/, not the project root, on the .ndx/ layout"
status: "in_progress"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review-2026-10-12"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-15T06:19:24.578Z"
acceptanceCriteria:
  - "On the .ndx/ layout, FileStore's takeSaveFileReport after a save lists paths starting with .ndx/rex/prd_tree/ (new test)"
  - "On the .ndx/ layout, FolderTreeStore's takeSaveFileReport after a save lists paths starting with .ndx/rex/prd_tree/ (new test)"
  - "Legacy .rex/ layout save reports are unchanged; existing tests pass unedited"
description: "Found by the adversarial review of b3ae06d2 (ChangeLayerStore save report). Verdict: out-of-scope, since it predates that change; worth fixing.\n\nDefect: FileStore (packages/rex/src/store/file-adapter.ts:374 and :640) and FolderTreeStore (packages/rex/src/store/folder-tree-store.ts:143) build their SaveFileReport against dirname(this.rexDir). On the .ndx/ layout rexDir is <root>/.ndx/rex, so dirname is the .ndx container. The paths come out as \"rex/prd_tree/...\", not \".ndx/rex/prd_tree/...\". The SaveFileReport contract says the paths are project-relative.\n\nScenario: a project on the .ndx/ layout with a v1 tree runs `ndx work`. hench's scopePrdPathsToReport (packages/hench/src/agent/lifecycle/shared.ts) keeps only paths starting with `${rexDirName}/prd_tree/` (\".ndx/rex/prd_tree/\"). Every report path is dropped, so the completion commit stages only tree-meta.json and leaves the task's index.md edits dirty and unattributed.\n\nReachability: any v1 project migrated to the .ndx/ layout (core migrate-layout). ChangeLayerStore already uses projectRootOf (fixed in the b3ae06d2 review).\n\nFix (recommended, cheap): use projectRootOf(this.rexDir) from @n-dx/llm-client, which rex already imports in store/project-config.ts. Add a test per store that copies a tree under <tmp>/.ndx/rex and asserts the report paths start with \".ndx/rex/\". Risk: none on the legacy layout, where projectRootOf equals dirname.\n\nOperator note (overnight 2026-10-15): Fix in packages/rex/src/store/file-adapter.ts and packages/rex/src/store/folder-tree-store.ts with projectRootOf from @n-dx/llm-client, plus one rex test per store. Also add a hench test proving the corrected report paths stage correctly on the .ndx/ layout: put it in a NEW test file (for example packages/hench/tests/integration/ndx-layout-prd-commit.test.ts) that drives the exported completion-commit path the way packages/hench/tests/integration/completion-metadata-commit.test.ts does. Do not edit packages/hench/src or existing hench test files; if the hench test cannot be written without that, skip only the hench test and say why. Do not edit these files, which other sessions own tonight: packages/rex/src/core/apply-amendments.ts, packages/rex/src/core/change-completion.ts, packages/rex/src/migrations/, packages/rex/src/store/prd-model-writer.ts, packages/rex/src/cli/index.ts, packages/rex/src/cli/help.ts, the rex MCP tool handlers (update_task_status, edit_item, move_item, merge_items, claim_task, health), packages/rex/tests/unit/schema/v2.test.ts, hench run and task-lookup source, packages/web, packages/sourcevision, packages/core/cli.js, help.js, command-effects.js, README.md, docs/guide/commands.md, tests/setup-session-env.js. If the fix needs one of them, stop and say so in your summary instead of editing it. The pinning test must fail on the code before your fix; say in your summary how you checked that. Run the six static root policy tests (tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy) before committing. Do not add a changeset; the operator adds one per layer."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:19:24.858Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
