---
id: "3907de2e-6713-42b3-a260-47f05c6dbe71"
level: "task"
title: "Update rex migrate-to-folder-tree to produce slug-named directories and offer prd.md removal"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "migration"
  - "rex"
source: "smart-add"
startedAt: "2026-04-29T16:01:29.610Z"
completedAt: "2026-04-29T18:16:15.362Z"
endedAt: "2026-04-29T18:16:15.362Z"
resolutionType: "code-change"
resolutionDetail: "Rewrote cmdMigrateToFolderTree with legacy source loading, level-count summary, and delete prompt"
acceptanceCriteria:
  - "Migration command produces folder tree with slug-based directory names at all four levels"
  - "Migration command prompts to delete prd.md (and branch-scoped variants) after successful migration"
  - "Re-running migration on an already-migrated folder tree is a no-op with an informational message"
  - "Migration command emits a summary showing item counts per PRD level"
  - "Auto-trigger detection (first-run migration) updated to produce slug-based paths"
description: "Extend the existing migration command to generate the slug-based folder naming convention and, after a successful migration, prompt the user to delete prd.md and any branch-scoped prd_{branch}_{date}.md files. Ensure the command is idempotent so re-running it on an already-migrated tree is a safe no-op."
---

# Update rex migrate-to-folder-tree to produce slug-named directories and offer prd.md removal

🟠 [completed]

## Summary

Extend the existing migration command to generate the slug-based folder naming convention and, after a successful migration, prompt the user to delete prd.md and any branch-scoped prd_{branch}_{date}.md files. Ensure the command is idempotent so re-running it on an already-migrated tree is a safe no-op.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** prd, migration, rex
- **Level:** task
- **Started:** 2026-04-29T16:01:29.610Z
- **Completed:** 2026-04-29T18:16:15.362Z
- **Duration:** 2h 14m
