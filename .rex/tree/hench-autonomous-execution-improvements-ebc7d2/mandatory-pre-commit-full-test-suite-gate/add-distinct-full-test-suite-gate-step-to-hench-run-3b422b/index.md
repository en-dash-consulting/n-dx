---
id: "3b422b8a-8112-461f-b727-b1036b2777ee"
level: "task"
title: "Add distinct full-test-suite gate step to hench run lifecycle before commit"
status: "completed"
priority: "critical"
tags:
  - "hench"
  - "testing"
  - "commit-gate"
source: "smart-add"
startedAt: "2026-04-30T15:21:12.772Z"
completedAt: "2026-04-30T15:39:50.582Z"
endedAt: "2026-04-30T15:39:50.582Z"
resolutionType: "code-change"
resolutionDetail: "Implemented mandatory full test suite gate with interactive failure handling, rerun loop, and three-action prompt (rerun/abort/skip). Gate runs unconditionally unless skipFullTestGate flag set, blocks commit on any test failure, and surfaces structured summary with package count and failure details."
acceptanceCriteria:
  - "A distinct stage labeled as the full-suite test gate appears in hench run output between work completion and commit"
  - "Commit is blocked when any test in the full suite fails, even if the failure is unrelated to the task's changed files"
  - "Gate failure surfaces a structured summary (command run, exit code, failing test count) and offers rerun/abort/skip-via-flag options"
  - "Gate runs unconditionally unless the documented opt-out flag is present"
  - "Integration test verifies that an unrelated pre-existing failing test blocks the commit on a hench run"
description: "Insert a dedicated, named lifecycle step between task work completion and the commit phase that runs the entire project test suite. The step must be visible in CLI output as its own stage (separate from any task-scoped checks), block the commit on any failure regardless of whether the failure is related to the current task's changes, and surface a clear pass/fail summary. Failures must halt the run before staging/committing and present the user with rerun, skip-with-flag, and abort options consistent with existing rollback prompt UX."
---

# Add distinct full-test-suite gate step to hench run lifecycle before commit

🔴 [completed]

## Summary

Insert a dedicated, named lifecycle step between task work completion and the commit phase that runs the entire project test suite. The step must be visible in CLI output as its own stage (separate from any task-scoped checks), block the commit on any failure regardless of whether the failure is related to the current task's changes, and surface a clear pass/fail summary. Failures must halt the run before staging/committing and present the user with rerun, skip-with-flag, and abort options consistent with existing rollback prompt UX.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** hench, testing, commit-gate
- **Level:** task
- **Started:** 2026-04-30T15:21:12.772Z
- **Completed:** 2026-04-30T15:39:50.582Z
- **Duration:** 18m
