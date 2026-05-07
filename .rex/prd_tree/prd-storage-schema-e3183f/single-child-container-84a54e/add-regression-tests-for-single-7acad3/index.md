---
id: "7acad3da-6e29-4e52-bed1-121ad63b4fd3"
level: "task"
title: "Add regression tests for single-child compaction across write path and reshape migration"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "testing"
  - "folder-tree"
  - "reshape"
  - "prd-storage"
  - "regression"
  - "serializer"
source: "smart-add"
startedAt: "2026-05-06T20:06:01.842Z"
completedAt: "2026-05-07T00:12:53.625Z"
endedAt: "2026-05-07T00:12:53.625Z"
resolutionType: "code-change"
resolutionDetail: "Added comprehensive regression tests for single-child compaction. Implemented 9 new tests across two test files: (1) 4 serializer unit tests in folder-tree-serializer.test.ts verifying single-child optimization produces flat files with embedded parent metadata and multi-child preserves normal structure, (2) 2 reshape integration tests in single-child-compaction-regression.test.ts validating compaction of fixture trees with 3 over-wrapped directories and metadata preservation, (3) 3 parser round-trip tests confirming full cycle fidelity. All new tests pass. Existing 29 parser tests unaffected."
acceptanceCriteria:
  - "Serializer unit test: single-child container produces a flat file, not a subdirectory + index.md"
  - "Serializer unit test: two-child container still produces the existing subdirectory structure"
  - "Reshape integration test: fixture tree with 3 over-wrapped directories is fully compacted in one reshape run"
  - "Reshape integration test: re-running reshape on the compacted fixture produces no further changes"
  - "Parser unit test: compacted tree round-trips back to the original PRD item tree with all titles, statuses, and metadata intact"
  - "Serializer unit test: single-child folder fixture produces exactly one file with no index.md"
  - "Serializer unit test: two-child folder fixture produces named files plus one index.md"
  - "Parser unit test: legacy folder with index.md and one named file parses without duplicate fields"
  - "Reshape integration test: single-child folder with index.md is reduced to named file only after reshape runs"
  - "All four tests run in the existing rex test suite with no new test infrastructure required"
description: "Write regression tests covering both surfaces introduced by single-child compaction: (1) serializer unit tests asserting the new write-path behavior for single-child vs multi-child containers, and (2) integration tests for the reshape compaction pass using a fixture prd_tree containing known over-wrapped directories. Tests should verify idempotency, metadata preservation, and that no data is lost when a wrapper directory is collapsed."
---

# Add regression tests for single-child compaction across write path and reshape migration

🟠 [completed]

## Summary

Write regression tests covering both surfaces introduced by single-child compaction: (1) serializer unit tests asserting the new write-path behavior for single-child vs multi-child containers, and (2) integration tests for the reshape compaction pass using a fixture prd_tree containing known over-wrapped directories. Tests should verify idempotency, metadata preservation, and that no data is lost when a wrapper directory is collapsed.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, testing, folder-tree, reshape, prd-storage, regression, serializer
- **Level:** task
- **Started:** 2026-05-06T20:06:01.842Z
- **Completed:** 2026-05-07T00:12:53.625Z
- **Duration:** 4h 6m
