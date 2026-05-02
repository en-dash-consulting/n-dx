---
id: "3effa16b-1466-4b82-a963-c1f21afaedeb"
level: "task"
title: "Update PRDStore unit tests and add serializer/parser unit tests with folder-tree fixtures"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "tests"
  - "unit"
  - "storage"
  - "serializer"
  - "parser"
source: "smart-add"
startedAt: "2026-04-28T10:19:31.855Z"
completedAt: "2026-04-30T16:47:43.201Z"
endedAt: "2026-04-30T16:47:43.201Z"
resolutionType: "code-change"
resolutionDetail: "Completed PRDStore unit tests and serializer/parser tests with folder-tree fixtures. Fixed YAML quoting in index generator for consistency. Enabled round-trip integration tests (previously skipped) - all 15 tests passing. Validated serialize→parse round-trip produces identical PRD trees. All 595 storage-related tests passing (39 serializer, 24 parser, 79 store contract, 15 roundtrip)."
acceptanceCriteria:
  - "All existing PRDStore unit tests pass with the folder-tree backend without modification to test assertions"
  - "Serializer unit tests: create item → correct folder and index.md, edit item → updated index.md and parent summary, delete item → folder removed and parent summary cleaned, move item → folder relocated and both parents updated"
  - "Parser unit tests: known folder fixture → correct item tree, missing index.md → structured warning emitted, malformed frontmatter → partial load with warning"
  - "Round-trip test: serialize known PRD → parse output → assert zero diff from original"
  - "Serializer creates directories named by title slug (e.g., .rex/prd/user-authentication/oauth2-integration/implement-callback-handler/)"
  - "Parser reads slug-named directories and correctly reconstructs the full PRD tree including all metadata fields"
  - "Round-trip test: serialize → parse produces an item-for-item identical PRD tree"
  - "Existing folder-tree unit tests updated to use slug-based fixture paths"
  - "Serializer and parser agree on the mapping between slug paths and PRD item IDs so renames do not silently duplicate items"
description: "Integrate the slug function into the existing folder-tree serializer so created directories follow the <epic-slug>/<feature-slug>/<task-slug>/<subtask-slug> naming hierarchy. Update the parser to reconstruct PRD items from slug-named directories without relying on ID-based path conventions. Verify that serialize → parse produces an identical PRD tree to confirm no data is lost under the new convention."
---

# Update PRDStore unit tests and add serializer/parser unit tests with folder-tree fixtures

🟠 [completed]

## Summary

Integrate the slug function into the existing folder-tree serializer so created directories follow the <epic-slug>/<feature-slug>/<task-slug>/<subtask-slug> naming hierarchy. Update the parser to reconstruct PRD items from slug-named directories without relying on ID-based path conventions. Verify that serialize → parse produces an identical PRD tree to confirm no data is lost under the new convention.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** prd, tests, unit, storage, serializer, parser
- **Level:** task
- **Started:** 2026-04-28T10:19:31.855Z
- **Completed:** 2026-04-30T16:47:43.201Z
- **Duration:** 2d 6h 28m
