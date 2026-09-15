---
id: "cbc45de5-7c4d-4b8b-95dc-c2cdb9d61798"
level: "task"
title: "Retain task claims when uncommitted-work completion is refused"
status: "blocked"
priority: "high"
tags:
  - "pr-06"
  - "claims"
  - "integration"
  - "blocked-on-pr-370"
blockedBy:
  - "b7774208-1ba3-47b4-bcc4-177e6b7ba3aa"
source: "ndx-capture"
acceptanceCriteria:
  - "After PR #370 is merged into main, a run refused solely because required work remains uncommitted does not make its task available for duplicate execution in another worktree."
  - "The retained claim has an explicit, recoverable cleanup or handoff path and cannot permanently block a task after its owner exits."
  - "Tests cover the uncommitted-work refusal path across two worktrees and distinguish it from ordinary successful, failed, and SIGINT runs."
  - "The claim lifecycle remains correct on Windows and POSIX CI."
description: "Integrate PR #371 with PR #370's uncommitted-work completion gate. A run that validated but cannot be completed because work remains uncommitted must not release its cross-worktree claim in finally and permit duplicate execution. Define a recoverable claim state and cleanup/release path; implement only after PR #370 is merged to main."
lastModified: "2026-09-13T20:13:09.675Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
