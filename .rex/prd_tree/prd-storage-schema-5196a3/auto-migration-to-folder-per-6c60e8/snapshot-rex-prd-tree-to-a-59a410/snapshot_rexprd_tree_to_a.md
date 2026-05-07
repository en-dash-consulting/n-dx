---
id: "59a410eb-d550-431f-97aa-66adab334494"
level: "task"
title: "Snapshot .rex/prd_tree to a timestamped backup before structural migration"
status: "pending"
priority: "high"
tags:
  - "prd-storage"
  - "migration"
  - "backup"
  - "safety"
source: "smart-add"
acceptanceCriteria:
  - "A timestamped copy of .rex/prd_tree is written to .rex/.backups/prd_tree_<ISO-timestamp>/ before any structural migration mutation"
  - "Backup creation is skipped when the structural migration pass would be a no-op"
  - "Migration failure surfaces the backup path and a copy-pasteable restore command in console output"
  - "Backup retention is capped (default last 10) with the oldest auto-pruned; the cap is configurable via .n-dx.json"
  - "Backup directory is added to .gitignore"
  - "Integration test simulates a migration failure mid-pass and asserts the backup directory is intact and restorable"
description: "Before any structural migration pass mutates the PRD tree (whether triggered by ndx reshape or by ndx add's pre-write check), copy the entire .rex/prd_tree directory to .rex/.backups/prd_tree_<ISO-timestamp>/ and record the backup path in the migration log. On migration failure, the command must surface the backup path and a copy-pasteable restore command. Cap retained backups (e.g., last 10) to avoid unbounded disk growth, and skip backup creation when the tree is already conforming and no migration would run."
---
