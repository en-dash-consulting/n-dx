---
id: "c380c2fa-720a-4d83-ab7b-fd110dbf3ba9"
level: "task"
title: "change-management guide tells users to run commands that do not exist and diff a PRD file that is never written"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "docs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "docs/guide/change-management.md names no command absent from getOrchestratorCommands() or rex's subcommand registry (no `ndx schedule`, no `rex archive-prune`)"
  - "docs/guide/change-management.md contains no instruction that reads, diffs or copies `.rex/prd.json` as the live PRD; diff and backup steps target `.rex/prd_tree/` or `ndx prd export`"
  - "pnpm docs:build passes"
description: "Out-of-scope finding from the adversarial review of task ec5b4506 (tracker docs removal). Pre-existing; the tracker excision only made it visible.\n\nFailure scenario: a user following docs/guide/change-management.md (\"Keeping Your PRD Alive\", in the VitePress sidebar) runs `ndx schedule` (line 386) or `rex archive-prune --before=\"6m\" .` (line 301) and gets an unknown-command error — neither exists (no `schedule` in packages/core/help.js, no `archive-prune` anywhere in packages/rex/src). Five lines (90, 216, 316, 342 and the recovery section) treat `.rex/prd.json` as the live PRD: `git diff .rex/prd.json` shows nothing because no PRD mutation writes that file (the folder tree `.rex/prd_tree/` is the only write surface), and `cp .rex/prd.json .rex/prd.backup.json` as a pre-reset backup copies a stale legacy file or fails — a user relying on it before `ndx plan --accept` has no backup.\n\nReachable: any reader of the guide. Not covered: no test checks guide prose against real commands or the PRD invariant.\n\nOptions: (1, recommended) rewrite the affected lines against the folder tree — `git diff .rex/prd_tree/`, back up with `git stash`/a commit or `ndx prd export`, drop the `ndx schedule` and `archive-prune` lines or replace with real equivalents; cheap, docs only. (2) Retire the guide and fold its maintenance loop into workflow.md — larger, and the storage-v2 epic will rewrite PRD docs anyway, so (1) now and revisit with v2."
lastModified: "2026-10-06T07:37:42.456Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
