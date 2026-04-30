---
id: "e174fb23-4ce0-4377-95ca-250538d7635c"
level: "task"
title: "Implement automatic migration from single prd.json to branch-scoped multi-file format"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "migration"
  - "storage"
source: "smart-add"
startedAt: "2026-04-22T17:13:43.023Z"
completedAt: "2026-04-22T17:44:03.271Z"
resolutionType: "code-change"
resolutionDetail: "Implemented automatic migration from single prd.json to branch-scoped multi-file format via migrateLegacyPRD() in prd-migration.ts, integrated into resolveStore(). Fresh rex init creates branch-scoped files in git repos."
acceptanceCriteria:
  - "Detects legacy .rex/prd.json on PRDStore initialization and triggers migration"
  - "Migrates prd.json to prd_{branch}_{date}.json preserving all items, metadata, and parent references"
  - "Migration is idempotent — running twice does not duplicate or corrupt data"
  - "A timestamped backup of the original prd.json is created before migration"
  - "Post-migration, all commands work without manual intervention or re-initialization"
  - "rex init on a fresh project creates a branch-scoped PRD file directly instead of prd.json"
description: "Detect when .rex/prd.json exists as a legacy single-file PRD and automatically migrate it to the new naming convention on first access. The migration determines the current branch and first-commit date, renames the file to prd_{branch}_{date}.json, creates a backup of the original, and ensures all item IDs and parent references remain intact. Fresh rex init creates a branch-scoped file directly."
---

# Implement automatic migration from single prd.json to branch-scoped multi-file format

🟠 [completed]

## Summary

Detect when .rex/prd.json exists as a legacy single-file PRD and automatically migrate it to the new naming convention on first access. The migration determines the current branch and first-commit date, renames the file to prd_{branch}_{date}.json, creates a backup of the original, and ensures all item IDs and parent references remain intact. Fresh rex init creates a branch-scoped file directly.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, migration, storage
- **Level:** task
- **Started:** 2026-04-22T17:13:43.023Z
- **Completed:** 2026-04-22T17:44:03.271Z
- **Duration:** 30m
