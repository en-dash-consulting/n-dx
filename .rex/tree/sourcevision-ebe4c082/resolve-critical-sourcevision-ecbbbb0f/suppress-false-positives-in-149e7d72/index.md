---
id: "149e7d72-8c46-4a5a-a290-9e9a9e30870b"
level: "task"
title: "Suppress false positives in SourceVision analysis"
status: "completed"
priority: "medium"
startedAt: "2026-02-11T17:13:15.631Z"
completedAt: "2026-02-11T17:13:15.631Z"
acceptanceCriteria:
  - "Re-analysis produces no false-positive unused-export findings for class methods (renderer.ts, notion-adapter.ts) or type guards (v1.ts)"
  - "sourcevision analyze completes with fewer warnings/critical findings than the current 24"
  - "No critical-severity findings remain"
  - "No single test file calls more than ~30 unique functions"
  - "All existing tests still pass after the split"
description: "Address false-positive unused-export findings for class instance methods and confirmed-used type guards so they stop appearing in future analyses.\n\n---\n\nFinal validation pass: re-run sourcevision analyze after all fixes and confirm the total finding count has dropped significantly.\n\n---\n\nSplit the 2111-line zones.test.ts (flagged for calling 82 unique functions) into focused test files organized by concern."
---

## Subtask: Fix false-positive detection for class instance methods

**ID:** `bcce9423-06c0-4773-a067-65e47b998d13`
**Status:** completed
**Priority:** medium

SourceVision flags class instance methods as "unused exports" because they're called via instance.method() not import { method }. Affected files: renderer.ts (39 false positives), notion-adapter.ts (19 false positives). Either improve the call-graph analyzer to recognize class method usage, or add suppression annotations (@public JSDoc or sourcevision-ignore comments).

**Acceptance Criteria**

- renderer.ts and notion-adapter.ts no longer produce false-positive unused-export findings
- Fix applies generally to all classes, not just these two

---

## Subtask: Fix false-positive detection for type guards used via re-exports

**ID:** `36efadb8-1dbe-43e1-96a7-323878c30474`
**Status:** completed
**Priority:** low

packages/rex/src/schema/v1.ts exports 5 type guards (isRequirementCategory, isValidationType, isPriority, isItemLevel, isItemStatus) confirmed used in web/src/server/routes-rex.ts and routes-validation.ts. SourceVision flags them as unused because it may not follow the import chain. Either fix the import-graph traversal or add suppression.

**Acceptance Criteria**

- v1.ts type guards no longer flagged as unused exports

---

## Subtask: Run sourcevision analyze and confirm finding reduction

**ID:** `280fdf83-f7f6-4550-957f-cd6912206207`
**Status:** completed
**Priority:** medium

After all other tasks in this epic are complete, re-run sourcevision analyze on the full project. Compare the findings report against the baseline (24 findings: 2 critical anti-patterns, 2 critical suggestions, 6 warnings, etc.). Confirm that critical findings are resolved and overall count is significantly reduced.

**Acceptance Criteria**

- sourcevision analyze completes successfully
- 0 critical-severity findings remain
- Total finding count is lower than 24
- No new critical or warning findings introduced

---

## Subtask: Split zones.test.ts into focused test files by concern

**ID:** `2ec4de61-7d1e-4b89-940e-266ff403c3e4`
**Status:** completed
**Priority:** medium

packages/sourcevision/tests/unit/analyzers/zones.test.ts is 2111 lines and calls 82 unique functions. Split into separate test files organized by concern (e.g., zone-detection.test.ts, zone-merging.test.ts, zone-hierarchy.test.ts, zone-edge-cases.test.ts). Each file should test a cohesive subset of zone analysis behavior.

**Acceptance Criteria**

- zones.test.ts is replaced by 3+ focused test files
- No single test file exceeds ~800 lines or calls >30 unique functions
- All original test cases are preserved
- pnpm test passes

---
