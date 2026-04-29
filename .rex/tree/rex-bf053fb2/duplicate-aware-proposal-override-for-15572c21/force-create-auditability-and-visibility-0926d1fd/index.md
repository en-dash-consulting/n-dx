---
id: "0926d1fd-8215-4a09-abca-6b5e619df0a5"
level: "task"
title: "Force-create Auditability and Visibility"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T20:59:56.613Z"
completedAt: "2026-02-22T20:59:56.613Z"
acceptanceCriteria: []
description: "Persist and expose override markers so intentionally duplicated items can be traced later in CLI output and downstream tools."
---

## Subtask: Persist override marker metadata on force-created PRD items

**ID:** `c84f5f7a-2604-4056-b11c-efbea5e09bf3`
**Status:** completed
**Priority:** critical

Create an auditable record that a duplicate guard was overridden, including enough metadata to trace when and why the override happened.

**Acceptance Criteria**

- Force-created items store an override marker field in persisted PRD data
- Override marker captures duplicate reason reference and creation timestamp
- Items created through normal or merge paths do not receive override markers

---

## Subtask: Expose override markers in CLI/status and machine-readable outputs

**ID:** `aeff67a5-6a85-4827-ae5d-199cc3fbca5b`
**Status:** completed
**Priority:** high

Ensure override decisions are visible to operators and automation so duplicate exceptions can be reviewed and governed.

**Acceptance Criteria**

- Rex status/output surfaces an indicator for items created via force-create override
- JSON outputs include override marker fields without breaking existing schema consumers
- Output clearly differentiates override-created items from merged or normal additions

---
