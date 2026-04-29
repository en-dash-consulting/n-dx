---
id: "4355a9e7-45a4-497e-b269-b1515349c25e"
level: "task"
title: "Documentation and Test Coverage for Duplicate Overrides"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T21:18:12.426Z"
completedAt: "2026-02-22T21:18:12.426Z"
acceptanceCriteria: []
description: "Document the new behavior and lock it in with regression tests across detection, prompt decisions, and persistence."
---

## Subtask: Update CLI help and docs for duplicate detection and override choices

**ID:** `a9e0174e-4487-41df-83e1-0166b21f6fe9`
**Status:** completed
**Priority:** medium

Reduce operator confusion by documenting when duplicate prompts appear, what each option does, and how audit markers are represented.

**Acceptance Criteria**

- CLI help for rex add documents duplicate-aware prompt behavior and all three actions
- User-facing docs include examples for Cancel, Merge, and Proceed anyway flows
- Docs describe persisted override marker semantics and where they appear

---

## Subtask: Add unit and integration tests for duplicate detection, prompt outcomes, and override persistence

**ID:** `34c16f83-382d-4f5d-8aeb-046f2d127919`
**Status:** completed
**Priority:** high

Protect against regressions by testing detection accuracy and each user decision path end-to-end through persisted PRD state.

**Acceptance Criteria**

- Unit tests cover duplicate matcher behavior for existing and completed-item matches
- Integration tests verify Cancel writes nothing, Merge updates existing, and Proceed anyway creates marked items
- Tests assert override marker presence only on force-created items and absence on merged/normal items

---
