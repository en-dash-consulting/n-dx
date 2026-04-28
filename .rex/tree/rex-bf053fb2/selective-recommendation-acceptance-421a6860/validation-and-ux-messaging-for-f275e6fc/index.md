---
id: "f275e6fc-ca91-493f-98a5-96ebbf6f585e"
level: "task"
title: "Validation and UX messaging for selector input"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T03:45:05.472Z"
completedAt: "2026-02-21T03:45:05.472Z"
description: "Provide clear guardrails and user feedback for malformed or out-of-range index selectors so partial acceptance is safe and predictable."
---

## Subtask: Validate selector format and index bounds before applying acceptance

**ID:** `db6187b7-06d8-4080-b60d-77be0a2d4019`
**Status:** completed
**Priority:** high

Reject invalid selectors early to prevent unintended acceptance and ensure users receive deterministic errors for malformed syntax or unavailable indices.

**Acceptance Criteria**

- Inputs without `=` when selector mode is expected return a format error with an example
- Out-of-range indices (for example selecting 9 when only 8 exist) return a clear validation error
- Duplicate indices are de-duplicated before execution or explicitly rejected with a consistent rule

---

## Subtask: Add tests and help text for `=index` acceptance syntax

**ID:** `6ab546a1-20ea-4cde-8e29-0726c50448ae`
**Status:** completed
**Priority:** high

Document the new selector option and cover it with automated tests so behavior remains stable across future CLI and workflow changes.

**Acceptance Criteria**

- CLI help for `recommend --accept` includes an example using `=1,4,5`
- Unit tests cover valid parsing, invalid syntax, out-of-range values, and mixed whitespace
- Integration test verifies that selecting specific indices accepts only those recommendation items

---
