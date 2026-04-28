---
id: "2e6e214b-3110-4619-9b9c-c73b76e7f10a"
level: "task"
title: "Task-Level Utilization Chips and Details Fallback UX"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T19:27:42.952Z"
completedAt: "2026-02-22T19:27:42.952Z"
description: "Ensure task-level utilization displays remain deterministic and understandable when weekly budgets are missing or only partially configured."
---

## Subtask: Wire deterministic budget resolver into task chip and detail utilization calculations

**ID:** `ffe01541-f5d0-45f9-ad04-61cd9d225c0c`
**Status:** completed
**Priority:** critical

Route all task-level utilization percentage computation through the shared resolver so chips and detail panels cannot diverge.

**Acceptance Criteria**

- Task chips and task detail views use the same resolver output for budget selection
- When budget is resolved, utilization displays as a percentage rounded consistently across views
- When budget is missing, both views render the same fallback label and reason state
- No direct ad-hoc budget lookup remains in task-level UI calculation paths

---

## Subtask: Add integration tests for missing-budget and partial-budget task utilization states

**ID:** `6e2ab2d5-c7b3-4cf1-819d-29022b8b5f96`
**Status:** completed
**Priority:** high

Prevent regressions by verifying deterministic behavior for configured, partially configured, and unconfigured budget scenarios at task level.

**Acceptance Criteria**

- Integration tests cover: exact vendor/model budget, vendor-only fallback, and no-budget fallback
- Each scenario asserts chip text, detail text, and reason-code consistency
- Tests verify identical utilization output for the same task across list and detail views
- CI fails if fallback presentation or reason mapping changes unexpectedly

---
