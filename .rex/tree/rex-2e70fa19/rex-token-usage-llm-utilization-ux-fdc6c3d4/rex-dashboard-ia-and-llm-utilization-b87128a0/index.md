---
id: "b87128a0-7994-44a9-bd61-c729106aff5c"
level: "task"
title: "Rex Dashboard IA and LLM Utilization View"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T08:45:23.981Z"
completedAt: "2026-02-21T08:45:23.981Z"
acceptanceCriteria: []
description: "Promote token usage to a first-class Rex section and add a dedicated vendor/model utilization dashboard."
---

## Subtask: Promote Token Usage to a top-level Rex dashboard section

**ID:** `80acc8dc-0c82-4035-aa11-a0c532c920a4`
**Status:** completed
**Priority:** high

Reorganize navigation and routing so token usage is directly visible under Rex without being nested in secondary views.

**Acceptance Criteria**

- Rex sidebar/nav shows Token Usage as a parent-level section
- Existing deep links route to the new location without broken navigation
- Navigation tests confirm active-state behavior for the new section

---

## Subtask: Build LLM utilization dashboard grouped by configured vendor/model

**ID:** `ef63f86a-d638-47ad-b91c-6f467b7f8c7b`
**Status:** completed
**Priority:** high

Add a dashboard view that combines current project configuration and recent run usage to show totals, trends, and per-tool breakdowns.

**Acceptance Criteria**

- View displays totals by vendor/model for the selected time range
- View displays trend data across recent periods and per-tool (rex/hench/sourcevision) breakdown
- Displayed usage source and time window are visible in the UI

---
