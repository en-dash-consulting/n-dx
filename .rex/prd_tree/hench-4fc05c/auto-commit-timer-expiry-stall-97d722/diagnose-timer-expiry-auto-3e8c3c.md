---
id: "3e8c3c2a-c3ba-4385-97ae-a6b16cac6208"
level: "task"
title: "Diagnose timer-expiry auto-commit stall path in hench loop and identify blocking call site"
status: "completed"
priority: "critical"
tags:
  - "hench"
  - "loop"
  - "auto-commit"
  - "bug"
source: "smart-add"
startedAt: "2026-05-27T18:27:03.622Z"
completedAt: "2026-05-27T18:35:11.934Z"
endedAt: "2026-05-27T18:35:11.934Z"
resolutionType: "code-change"
resolutionDetail: "Diagnosed timer-expiry auto-commit stall path: the watcher fires asynchronously and deletes the message file, but performCommitPromptIfNeeded() had no way to detect this. Implemented acknowledgment signal by adding didAutoCommit() flag to CommitMsgWatcher that tracks successful auto-commits. performCommitPromptIfNeeded() now checks this flag and emits explicit acknowledgment message, allowing loop to proceed. Commit d7fd1ff49.\""
acceptanceCriteria:
  - "Identified the exact file and line where the loop stalls after a timer-expiry auto-commit"
  - "Determined whether the block is a prompt, an awaited event, or a state transition that never fires"
  - "Confirmed the diagnosis is reproducible — either by test or by documented reproduction steps"
  - "No production code changed in this task"
description: "Trace the hench run loop through the 'Auto-commit: committed staged changes (timer expiry)' code path to identify exactly where and why execution stalls in --yes/--loop mode. Determine whether the stall is a missing acknowledgment, an unhandled promise, a state machine gap, or an unexpected prompt waiting for input that --yes never satisfies."
---
