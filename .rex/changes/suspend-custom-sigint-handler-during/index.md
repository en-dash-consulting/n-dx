---
id: "5cfeee22-c15d-40ec-aa66-0983959703f5"
type: "change"
title: "Suspend custom SIGINT handler during rollback confirmation prompt"
slug: "suspend-custom-sigint-handler-during"
intent: "In shared.ts's performRollbackIfNeeded (and the promptRollbackConfirm helper it calls), the outer runLoop/epicByEpicLoop SIGINT handler is still registered and will call process.exit(1) on a second Ctrl-C. Before opening the readline prompt, temporarily remove the custom SIGINT listener (or restore SIG_DFL) so that the terminal behaves normally during the interactive question. Re-register (or re-override) the handler after the readline closes. The same issue exists in promptCommitConfirm — apply the same fix there. The fix should be coordinated so that callers pass a cleanup/suspend callback, or promptRollbackConfirm accepts an AbortSignal that lets it cleanly cancel if the outer loop is torn down."
acceptanceCriteria:
  - "After a single Ctrl-C during a running task, the 'Roll back N uncommitted file(s)? [Y/n]' prompt appears and remains active"
  - "A second Ctrl-C while the rollback prompt is displayed does NOT call process.exit(1); it either cancels the readline cleanly or is ignored until the user types a response"
  - "Answering 'y' at the rollback prompt reverts files and exits cleanly"
  - "Answering 'n' at the rollback prompt skips the rollback and exits cleanly"
  - "The same fix applies to the commit confirmation prompt (promptCommitConfirm) — a Ctrl-C during that prompt does not bypass the question"
  - "Non-interactive mode (--yes or non-TTY) is unaffected"
touches:
  - "469c7900-cd34-4919-bc40-5f474a96654a"
priority: "high"
tags:
  - "hench"
  - "ux"
  - "signal-handling"
source: "smart-add"
---
