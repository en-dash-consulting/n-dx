---
id: "6c60e804-cafe-4aad-94e7-3787a16222db"
type: "change"
title: "Auto-Migration to Folder-Per-Task Schema with Backup"
slug: "auto-migration-to-folder-per-task"
intent: "Make ndx reshape and ndx add idempotently bring any pre-existing PRD tree into compliance with the folder-per-task rule, converting bare task .md files into folder/index.md form and promoting subtask .md files that have orphaned child siblings. Always snapshot .rex/prd_tree to a timestamped backup before mutating, so a failed migration can be rolled back without data loss."
touches:
  - "607c72c9-5edf-4091-b0a8-77eea1484a40"
source: "smart-add"
---
