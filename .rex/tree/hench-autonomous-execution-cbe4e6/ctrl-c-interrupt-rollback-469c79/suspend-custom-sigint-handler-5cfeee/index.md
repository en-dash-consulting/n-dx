---
id: "5cfeee22-c15d-40ec-aa66-0983959703f5"
level: "task"
title: "Suspend custom SIGINT handler during rollback confirmation prompt"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "ux"
  - "signal-handling"
source: "smart-add"
startedAt: "2026-04-24T20:42:30.170Z"
completedAt: "2026-04-24T20:50:21.821Z"
resolutionType: "code-change"
resolutionDetail: "Added askYesNoWithSuspendedSigint helper in shared.ts that snapshots and detaches existing SIGINT listeners around the readline prompt, installs a temporary onInterrupt that cancels readline cleanly on Ctrl-C (resolving false = decline), and restores the original listeners in finally. Both promptRollbackConfirm and promptCommitConfirm now delegate to this helper. Added 5 integration tests in tests/integration/sigint-prompt.test.ts verifying: outer handler detached/restored around the prompt, SIGINT during prompt cancels cleanly without invoking the outer handler, readline-surface SIGINT works the same way, accept path still rolls back, and the same suspension applies to the commit-approval prompt."
acceptanceCriteria:
  - "After a single Ctrl-C during a running task, the 'Roll back N uncommitted file(s)? [Y/n]' prompt appears and remains active"
  - "A second Ctrl-C while the rollback prompt is displayed does NOT call process.exit(1); it either cancels the readline cleanly or is ignored until the user types a response"
  - "Answering 'y' at the rollback prompt reverts files and exits cleanly"
  - "Answering 'n' at the rollback prompt skips the rollback and exits cleanly"
  - "The same fix applies to the commit confirmation prompt (promptCommitConfirm) — a Ctrl-C during that prompt does not bypass the question"
  - "Non-interactive mode (--yes or non-TTY) is unaffected"
description: "In shared.ts's performRollbackIfNeeded (and the promptRollbackConfirm helper it calls), the outer runLoop/epicByEpicLoop SIGINT handler is still registered and will call process.exit(1) on a second Ctrl-C. Before opening the readline prompt, temporarily remove the custom SIGINT listener (or restore SIG_DFL) so that the terminal behaves normally during the interactive question. Re-register (or re-override) the handler after the readline closes. The same issue exists in promptCommitConfirm — apply the same fix there. The fix should be coordinated so that callers pass a cleanup/suspend callback, or promptRollbackConfirm accepts an AbortSignal that lets it cleanly cancel if the outer loop is torn down."
---

# Suspend custom SIGINT handler during rollback confirmation prompt

🟠 [completed]

## Summary

In shared.ts's performRollbackIfNeeded (and the promptRollbackConfirm helper it calls), the outer runLoop/epicByEpicLoop SIGINT handler is still registered and will call process.exit(1) on a second Ctrl-C. Before opening the readline prompt, temporarily remove the custom SIGINT listener (or restore SIG_DFL) so that the terminal behaves normally during the interactive question. Re-register (or re-override) the handler after the readline closes. The same issue exists in promptCommitConfirm — apply the same fix there. The fix should be coordinated so that callers pass a cleanup/suspend callback, or promptRollbackConfirm accepts an AbortSignal that lets it cleanly cancel if the outer loop is torn down.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, ux, signal-handling
- **Level:** task
- **Started:** 2026-04-24T20:42:30.170Z
- **Completed:** 2026-04-24T20:50:21.821Z
- **Duration:** 7m
