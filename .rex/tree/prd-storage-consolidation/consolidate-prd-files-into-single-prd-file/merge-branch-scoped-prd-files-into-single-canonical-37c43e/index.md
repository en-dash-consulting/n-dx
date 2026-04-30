---
id: "37c43e3c-bcce-432c-a953-9685f1618999"
level: "task"
title: "Merge branch-scoped PRD files into single canonical 'prd' file"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "migration"
source: "smart-add"
startedAt: "2026-04-23T01:33:12.091Z"
completedAt: "2026-04-23T01:54:23.844Z"
acceptanceCriteria:
  - "Rex store reads and writes a single file named 'prd' at the new canonical location"
  - "Existing multi-file / branch-scoped PRD layouts are auto-migrated into the unified 'prd' file on first load"
  - "No PRD items, logs, or metadata are lost during migration (verified by round-trip test)"
  - "CLI commands (rex add, ndx add, plan, status) operate against the unified file"
  - "MCP write tools (add_item, edit_item, update_task_status, merge_items, move_item) target the unified file"
description: "Replace the current multi-file branch-scoped PRD storage with a single consolidated file named 'prd' at the new canonical location. Combine content from any existing split files during load, write to the unified location on save, and add a one-time migration path that folds legacy multi-file layouts into the new single-file format without data loss."
---

# Merge branch-scoped PRD files into single canonical 'prd' file

🔴 [completed]

## Summary

Replace the current multi-file branch-scoped PRD storage with a single consolidated file named 'prd' at the new canonical location. Combine content from any existing split files during load, write to the unified location on save, and add a one-time migration path that folds legacy multi-file layouts into the new single-file format without data loss.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** rex, storage, migration
- **Level:** task
- **Started:** 2026-04-23T01:33:12.091Z
- **Completed:** 2026-04-23T01:54:23.844Z
- **Duration:** 21m
