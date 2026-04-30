---
id: "a6199e02-a954-44dd-b49f-c6519fa673e4"
level: "task"
title: "Implement git change rollback on failed hench runs"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "git"
  - "recovery"
source: "smart-add"
startedAt: "2026-04-16T15:12:12.343Z"
completedAt: "2026-04-16T21:41:40.638Z"
resolutionType: "code-change"
resolutionDetail: "Added rollbackOnFailure flag to SharedLoopOptions/FinalizeRunOptions, implemented listDirtyPaths+performRollbackIfNeeded helpers in shared.ts, threaded --no-rollback flag through run.ts/runIterations/runLoop/runEpicByEpic/cliLoop/agentLoop, and added 9 integration tests covering all failure statuses and the --no-rollback opt-out."
acceptanceCriteria:
  - "A pre-run git state marker is captured before hench modifies any files"
  - "On run failure, all uncommitted changes introduced during the run are reverted to the pre-run state"
  - "A --no-rollback flag suppresses automatic rollback and leaves changes in place"
  - "Rollback result (number of files reverted) is printed to the console after a failed run"
  - "If no changes were made during the run, the rollback step is skipped silently"
description: "When a hench work run ends in failure, detect the failure condition and revert uncommitted file changes introduced during the run. Capture a pre-run git state marker (stash ref or HEAD SHA) before hench begins modifying files, then perform a targeted rollback on failure. A --no-rollback flag allows the user to inspect partial changes instead of reverting."
---

# Implement git change rollback on failed hench runs

🟠 [completed]

## Summary

When a hench work run ends in failure, detect the failure condition and revert uncommitted file changes introduced during the run. Capture a pre-run git state marker (stash ref or HEAD SHA) before hench begins modifying files, then perform a targeted rollback on failure. A --no-rollback flag allows the user to inspect partial changes instead of reverting.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, git, recovery
- **Level:** task
- **Started:** 2026-04-16T15:12:12.343Z
- **Completed:** 2026-04-16T21:41:40.638Z
- **Duration:** 6h 29m
