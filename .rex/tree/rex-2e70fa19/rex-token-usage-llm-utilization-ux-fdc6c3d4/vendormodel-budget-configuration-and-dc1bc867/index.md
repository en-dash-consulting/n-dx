---
id: "dc1bc867-cc4f-4c7c-ac60-35d5b3e18e67"
level: "task"
title: "Vendor/Model Budget Configuration and Percentage Engine"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T08:28:31.947Z"
completedAt: "2026-02-21T08:28:31.947Z"
acceptanceCriteria: []
description: "Support configurable weekly token budgets by vendor/model and compute utilization percentages for tasks and project rollups."
---

## Subtask: Add weekly budget config keys scoped by vendor and model

**ID:** `c5d46dfd-59c7-4f66-8c23-b75ddb2a7b02`
**Status:** completed
**Priority:** high

Extend config schema and defaults to store weekly token allotments per provider/model combination, with validation and clear error messages.

**Acceptance Criteria**

- Config accepts budget entries keyed by vendor and model
- Invalid budget values or malformed keys are rejected with actionable validation errors
- CLI/config readout shows resolved weekly budgets for active project

---

## Subtask: Implement weekly percentage calculator for task and project utilization

**ID:** `a551af50-b98a-479d-b5e8-99f64b10d92e`
**Status:** completed
**Priority:** high

Compute usage percentages against configured weekly budgets using a deterministic time window and expose the result to API/UI consumers.

**Acceptance Criteria**

- Task utilization percentage is computed from task token total divided by matching vendor/model weekly budget
- Project utilization percentage is computed from summed weekly usage against summed applicable budgets
- Calculation tests cover boundary cases including zero budget, missing budget, and week rollover

---
