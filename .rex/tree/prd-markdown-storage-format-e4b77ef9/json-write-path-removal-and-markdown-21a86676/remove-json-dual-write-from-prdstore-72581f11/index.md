---
id: "72581f11-f8ee-46fd-8e2f-60bf6055850e"
level: "task"
title: "Remove JSON dual-write from PRDStore save operations"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "prd-storage"
  - "cleanup"
source: "smart-add"
startedAt: "2026-04-29T02:16:51.764Z"
completedAt: "2026-04-29T02:27:45.111Z"
endedAt: "2026-04-29T02:27:45.111Z"
resolutionType: "code-change"
resolutionDetail: "Dual-write was already removed in commit 348f2f9c. Updated test fixtures to seed prd.md and added 5 regression tests asserting saveDocument/addItem never create or modify prd.json."
acceptanceCriteria:
  - "PRDStore.saveDocument() writes only to .rex/prd.md and branch-scoped .rex/prd_*.md files — no .rex/prd.json"
  - "No method on PRDStore creates or modifies .rex/prd.json"
  - "Running ndx add on a project with no pre-existing prd.json does not create one"
  - "Running ndx add on a project with a pre-existing prd.json does not modify it"
  - "All existing PRDStore unit tests pass with the JSON write path removed"
description: "Locate the dual-write code in PRDStore.saveDocument() and related storage helpers introduced during the Markdown migration. Remove the JSON write side entirely, keeping only the Markdown (.md) write path. Verify that prd.json is no longer created or modified by any PRDStore method after the change."
---
