---
id: "a0c1e859-972f-4f95-adba-fc643da307d1"
level: "task"
title: "Timer-expiry auto-commit carries hench's trailers"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "hench"
acceptanceCriteria:
  - "A timer-expiry auto-commit gives the task id from `git log -1 --format='%(trailers:key=N-DX-Item,valueonly)'` (test, asserted through git's parser)"
  - "N-DX, N-DX-Item and Co-Authored-By sit in one final trailer block on the auto-commit (test)"
description: "Found while fixing the one-final-trailer-block task. When a run ends abnormally, the commit-msg watcher in packages/hench/src/agent/lifecycle/commit-msg-watcher.ts (tryAutoCommit) commits `.hench-commit-msg.txt` with `git commit -F` exactly as the agent wrote it. That commit gets no N-DX, N-DX-Item or Co-Authored-By trailer, so rex's realized-by edge never sees it. Pass the run's trailers into startCommitMsgWatcher (cli-loop.ts ~2237) and add them with appendTrailerBlock from agent/lifecycle/commit-trailers.ts, the same way performCommitPromptIfNeeded does."
lastModified: "2026-10-09T03:40:11.260Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
