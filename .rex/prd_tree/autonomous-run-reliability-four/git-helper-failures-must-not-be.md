---
id: "08d050ce-f4ca-451e-9bb5-fd423f17c994"
level: "task"
title: "Git helper failures must not be reported as successful staging or commits"
status: "pending"
priority: "medium"
tags:
  - "hench"
  - "git"
  - "ndx-capture"
source: "ndx-capture"
acceptanceCriteria:
  - "A failed Git add or commit returns a non-success result to the Hench lifecycle and no success message is printed."
  - "A rejected signing request, failing hook, or Git identity error cannot be reported as a completed stage or commit operation."
  - "A failed task-specific Git operation leaves the affected PRD write visible to the existing uncommitted-work gate; a later task cannot silently absorb it."
  - "Regression tests force non-zero Git outcomes for the affected helpers and assert the user-facing result and working-tree safety."
  - "Focused Hench tests and typecheck pass, with a patch changeset for @n-dx/hench."
description: "P2 follow-up approved for PR #370. The Hench lifecycle uses execStdout for git add and git commit helpers even though it resolves an empty result on command failure. A rejected signing prompt, pre-commit hook, or Git identity error can therefore print Staged or Committed despite no Git mutation. Preserve the original failure, do not claim success, and prevent a later task from absorbing the previous task's PRD write. Review evidence: packages/hench/src/agent/lifecycle/shared.ts helper paths around stageReviewRepairs and commitResetDeferredChanges, backed by execStdout behavior in the shared execution helper."
lastModified: "2026-09-15T02:08:37.530Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
