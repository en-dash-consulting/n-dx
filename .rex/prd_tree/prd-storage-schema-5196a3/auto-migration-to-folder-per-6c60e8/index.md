---
id: "6c60e804-cafe-4aad-94e7-3787a16222db"
level: "feature"
title: "Auto-Migration to Folder-Per-Task Schema with Backup"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Make ndx reshape and ndx add idempotently bring any pre-existing PRD tree into compliance with the folder-per-task rule, converting bare task .md files into folder/index.md form and promoting subtask .md files that have orphaned child siblings. Always snapshot .rex/prd_tree to a timestamped backup before mutating, so a failed migration can be rolled back without data loss."
---

# Auto-Migration to Folder-Per-Task Schema with Backup

 [pending]

## Summary

Make ndx reshape and ndx add idempotently bring any pre-existing PRD tree into compliance with the folder-per-task rule, converting bare task .md files into folder/index.md form and promoting subtask .md files that have orphaned child siblings. Always snapshot .rex/prd_tree to a timestamped backup before mutating, so a failed migration can be rolled back without data loss.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add folder-per-task structural migration pass to ndx reshape and ndx add | task | in_progress | 2026-05-07 |
| Snapshot .rex/prd_tree to a timestamped backup before structural migration | task | pending | 1970-01-01 |

## Info

- **Status:** pending
- **Level:** feature
