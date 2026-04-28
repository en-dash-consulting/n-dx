---
id: "1ed80b60-1fcf-48c8-83db-05949b03676c"
level: "task"
title: "Event-metadata-driven utilization aggregation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T21:34:31.533Z"
completedAt: "2026-02-21T21:34:31.533Z"
description: "Rework utilization calculations to aggregate by per-event vendor/model metadata rather than current configured model values."
---

## Subtask: Refactor utilization aggregation to group by event vendor/model

**ID:** `2a228461-e3ba-4db7-9f4d-bc5086f571e6`
**Status:** completed
**Priority:** critical

Change aggregation queries and reducers to use vendor/model stored on each event as the grouping key so historical and mixed-model usage is reported correctly.

**Acceptance Criteria**

- Utilization totals are grouped by vendor+model from event records, not from current config
- Changing project config after events are recorded does not alter historical utilization group assignment
- Aggregated totals equal the sum of raw event token counts for each vendor/model group

---

## Subtask: Implement fallback bucketing for incomplete event metadata

**ID:** `bb53a672-0ebf-4893-a699-5ef6b0083cbc`
**Status:** completed
**Priority:** high

Prevent data loss by routing events with missing attribution into explicit fallback buckets that remain visible in utilization outputs.

**Acceptance Criteria**

- Events missing vendor and/or model are included in utilization under deterministic fallback labels
- Fallback-labeled totals are surfaced in the same API/UI responses as normal vendor/model groups
- No token events are dropped from totals due to missing metadata fields

---

## Subtask: Add cross-package regression tests for attribution and grouping

**ID:** `0a630d51-b9e0-46ad-bc29-6964ecedc0ab`
**Status:** completed
**Priority:** high

Create tests that simulate Rex, Hench, and SourceVision events with mixed vendors/models to verify end-to-end attribution and aggregation behavior.

**Acceptance Criteria**

- Test fixtures include events from all three packages with at least two distinct vendor/model pairs
- Assertions verify aggregation groups match event metadata and not current configured model
- Assertions verify fallback bucket behavior for events with missing metadata
- All new tests pass in CI test suites covering usage aggregation

---
