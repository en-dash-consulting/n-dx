---
id: "a0c1e859-972f-4f95-adba-fc643da307d1"
level: "task"
title: "Timer-expiry auto-commit carries hench's trailers"
status: "completed"
priority: "medium"
tags:
  - "product-map"
  - "hench"
startedAt: "2026-10-09T04:10:59.597Z"
completedAt: "2026-10-09T04:14:36.031Z"
endedAt: "2026-10-09T04:14:36.031Z"
acceptanceCriteria:
  - "A timer-expiry auto-commit gives the task id from `git log -1 --format='%(trailers:key=N-DX-Item,valueonly)'` (test, asserted through git's parser)"
  - "N-DX, N-DX-Item and Co-Authored-By sit in one final trailer block on the auto-commit (test)"
description: "Found while fixing the one-final-trailer-block task. When a run ends abnormally, the commit-msg watcher in packages/hench/src/agent/lifecycle/commit-msg-watcher.ts (tryAutoCommit) commits `.hench-commit-msg.txt` with `git commit -F` exactly as the agent wrote it. That commit gets no N-DX, N-DX-Item or Co-Authored-By trailer, so rex's realized-by edge never sees it. Pass the run's trailers into startCommitMsgWatcher (cli-loop.ts ~2237) and add them with appendTrailerBlock from agent/lifecycle/commit-trailers.ts, the same way performCommitPromptIfNeeded does. Before finishing, run `pnpm build` in packages/hench: the test gate reads hench through dist/ and fails a run that edits source without rebuilding (the stale-dist failure of run 31bed159)."
lastModified: "2026-10-09T04:14:36.674Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
