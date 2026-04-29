---
id: "530ae182-1f26-4cc4-bc77-314954ec2112"
level: "task"
title: "Token Usage Data Pipeline Recovery"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T08:11:27.793Z"
completedAt: "2026-02-21T08:11:27.793Z"
acceptanceCriteria: []
description: "Restore end-to-end token accounting so Rex task and dashboard usage values reflect real run data instead of zeroed counters."
---

## Subtask: Implement unified usage event normalization across Rex, Hench, and SourceVision logs

**ID:** `c58a8b7e-fa92-46a0-a852-f05b402014db`
**Status:** completed
**Priority:** critical

Create a shared normalization path that converts vendor-specific usage payloads into one canonical shape so downstream aggregation is consistent.

**Acceptance Criteria**

- Usage records from rex, hench, and sourcevision are ingested into a single normalized structure
- Normalized records include vendor, model, tool, timestamp, and token totals when present
- Records missing optional fields are still accepted with explicit null/default values

---

## Subtask: Fix Rex token aggregation queries that return zero for tasks and dashboard totals

**ID:** `b6f9d583-5ea5-4ffb-8ebb-de729091eb78`
**Status:** completed
**Priority:** critical

Correct the aggregation logic and joins/lookups so token totals resolve from normalized usage events to task-level and project-level views.

**Acceptance Criteria**

- At least one fixture run with non-zero usage produces non-zero task totals in Rex
- Dashboard project totals match the sum of the same-period task totals
- Regression test fails on prior zero-count behavior and passes with fix

---
