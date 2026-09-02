---
id: "6c60e804-cafe-4aad-94e7-3787a16222db"
level: "feature"
title: "Auto-Migration to Folder-Per-Task Schema with Backup"
status: "completed"
source: "smart-add"
startedAt: "2026-05-08T00:47:51.278Z"
completedAt: "2026-05-08T00:47:51.278Z"
endedAt: "2026-05-08T00:47:51.278Z"
acceptanceCriteria: []
description: "Make ndx reshape and ndx add idempotently bring any pre-existing PRD tree into compliance with the folder-per-task rule, converting bare task .md files into folder/index.md form and promoting subtask .md files that have orphaned child siblings. Always snapshot .rex/prd_tree to a timestamped backup before mutating, so a failed migration can be rolled back without data loss."
---

## Children

| Title | Status |
|-------|--------|
| [Add folder-per-task structural migration pass to ndx reshape and ndx add](./add-folder-per-task-structural-4feb76.md) | completed |
| [Snapshot .rex/prd_tree to a timestamped backup before structural migration](./snapshot-rex-prd-tree-to-a-59a410.md) | completed |
