---
id: "3c667571-af87-44b2-86c5-7752d0b58d57"
level: "task"
title: "Fallback Trigger and Quality Regression Coverage"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T00:51:43.680Z"
completedAt: "2026-02-23T00:51:43.680Z"
acceptanceCriteria: []
description: "Add automated tests validating fallback activation, output structure, and metadata correctness across key failure modes."
---

## Subtask: Add unit tests for fallback trigger classification across git failure modes

**ID:** `76f82338-2974-4384-a6ed-d4b944cce129`
**Status:** completed
**Priority:** critical

Protect routing logic by verifying that only intended preflight/fetch/diff failures activate fallback generation.

**Acceptance Criteria**

- Tests cover at least preflight failure, fetch failure, and diff failure trigger paths
- Tests assert non-git internal errors do not silently switch to fallback
- All trigger classification tests pass in CI without network dependencies

---

## Subtask: Add integration tests for fallback markdown labeling and metadata fields

**ID:** `f94472c7-65db-4909-aac0-c2cb2677b3d5`
**Status:** completed
**Priority:** high

Validate end-to-end behavior so generated fallback markdown and API payloads remain reviewer-safe and machine-consumable.

**Acceptance Criteria**

- Integration test asserts fallback markdown includes explicit mode label when diff generation is forced to fail
- Integration test asserts API payload includes confidence and coverage metadata with valid numeric ranges
- Integration test asserts successful git-diff path does not show fallback label

---
