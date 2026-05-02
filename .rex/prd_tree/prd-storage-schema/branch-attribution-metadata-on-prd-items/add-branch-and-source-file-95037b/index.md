---
id: "95037bd6-871c-4a16-bf90-90a081dbfe9e"
level: "task"
title: "Add branch and source-file fields to PRD item schema and storage"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "schema"
  - "backend"
source: "smart-add"
startedAt: "2026-04-24T16:39:25.070Z"
completedAt: "2026-04-24T16:44:27.245Z"
endedAt: "2026-04-24T16:44:27.245Z"
resolutionType: "code-change"
resolutionDetail: "Added optional branch/sourceFile fields to PRD item typing and validation, preserved them in markdown serialization, and added validation, store round-trip, and status JSON coverage."
acceptanceCriteria:
  - "PRD item schema accepts optional `branch: string` and `sourceFile: string` fields at all levels (epic, feature, task, subtask)"
  - "Fields are preserved through JSON serialization and deserialization without data loss"
  - "Existing items that lack these fields remain valid and load without error"
  - "`rex status --format=json` output includes `branch` and `sourceFile` when present on an item"
description: "PRD items currently carry no record of which git branch or PRD file they originate from. Adding optional `branch` and `sourceFile` fields to the item schema is the prerequisite for all downstream attribution display. The fields must survive JSON round-trips and remain backward-compatible so existing PRD files need no migration."
---

# Add branch and source-file fields to PRD item schema and storage

🟠 [completed]

## Summary

PRD items currently carry no record of which git branch or PRD file they originate from. Adding optional `branch` and `sourceFile` fields to the item schema is the prerequisite for all downstream attribution display. The fields must survive JSON round-trips and remain backward-compatible so existing PRD files need no migration.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, schema, backend
- **Level:** task
- **Started:** 2026-04-24T16:39:25.070Z
- **Completed:** 2026-04-24T16:44:27.245Z
- **Duration:** 5m
