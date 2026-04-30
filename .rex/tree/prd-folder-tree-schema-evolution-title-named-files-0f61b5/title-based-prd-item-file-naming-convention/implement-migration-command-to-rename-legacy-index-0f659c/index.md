---
id: "0f659c06-3f19-4957-88eb-a72ccaaff145"
level: "task"
title: "Implement migration command to rename legacy index.md files to title-based names"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "migration"
  - "prd"
source: "smart-add"
startedAt: "2026-04-30T01:05:15.536Z"
completedAt: "2026-04-30T01:20:07.238Z"
endedAt: "2026-04-30T01:20:07.238Z"
resolutionType: "code-change"
resolutionDetail: "Created migrate-folder-tree-filenames.ts with full migration logic including collision detection and logging. Registered in CLI. Added 18 passing unit tests covering all requirements."
acceptanceCriteria:
  - "CLI command renames all legacy `index.md` files under `.rex/tree/` to their title-based filenames"
  - "Idempotent: re-running the command after success is a no-op"
  - "Detects sibling filename collisions and either reports them or appends a stable disambiguator (e.g., short id suffix)"
  - "Auto-trigger: PRDStore detects legacy layout on first read and runs migration before parsing"
  - "Migration logs each rename to `.rex/execution-log.jsonl`"
  - "End-to-end test migrates a fixture tree containing nested epics/features/tasks and verifies post-migration state"
description: "Add a `rex migrate-folder-tree-filenames` command (or extend the existing `rex migrate-to-folder-tree`) that walks `.rex/tree/`, renames each item's `index.md` to its title-based filename, and reserves `index.md` for the new folder-summary role. The migration must be idempotent, must detect filename collisions across siblings, and must log every rename for audit. Auto-trigger detection should run the migration on first read after upgrade."
---

# Implement migration command to rename legacy index.md files to title-based names

🟠 [completed]

## Summary

Add a `rex migrate-folder-tree-filenames` command (or extend the existing `rex migrate-to-folder-tree`) that walks `.rex/tree/`, renames each item's `index.md` to its title-based filename, and reserves `index.md` for the new folder-summary role. The migration must be idempotent, must detect filename collisions across siblings, and must log every rename for audit. Auto-trigger detection should run the migration on first read after upgrade.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, migration, prd
- **Level:** task
- **Started:** 2026-04-30T01:05:15.536Z
- **Completed:** 2026-04-30T01:20:07.238Z
- **Duration:** 14m
