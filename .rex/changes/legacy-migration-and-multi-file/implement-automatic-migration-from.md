---
id: "e174fb23-4ce0-4377-95ca-250538d7635c"
type: "task"
title: "Implement automatic migration from single prd.json to branch-scoped multi-file format"
slug: "implement-automatic-migration-from"
description: "Detect when .rex/prd.json exists as a legacy single-file PRD and automatically migrate it to the new naming convention on first access. The migration determines the current branch and first-commit date, renames the file to prd_{branch}_{date}.json, creates a backup of the original, and ensures all item IDs and parent references remain intact. Fresh rex init creates a branch-scoped file directly."
acceptanceCriteria:
  - "Detects legacy .rex/prd.json on PRDStore initialization and triggers migration"
  - "Migrates prd.json to prd_{branch}_{date}.json preserving all items, metadata, and parent references"
  - "Migration is idempotent — running twice does not duplicate or corrupt data"
  - "A timestamped backup of the original prd.json is created before migration"
  - "Post-migration, all commands work without manual intervention or re-initialization"
  - "rex init on a fresh project creates a branch-scoped PRD file directly instead of prd.json"
priority: "high"
tags:
  - "rex"
  - "migration"
  - "storage"
source: "smart-add"
---
