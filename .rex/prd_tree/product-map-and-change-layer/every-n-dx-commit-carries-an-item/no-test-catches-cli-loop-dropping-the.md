---
id: "cbd8c3bf-9ef4-4c2f-8791-9584a20ee05f"
level: "task"
title: "No test catches cli-loop dropping the run's trailers from the timer-expiry watcher"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T04:43:05.599Z"
completedAt: "2026-10-09T04:48:17.162Z"
endedAt: "2026-10-09T04:48:17.162Z"
resolutionType: "code-change"
resolutionDetail: "Verified and closed by the operator. Run 3aa0f093-3eaf-4c9b-b482-a1ef82d02d49 (claude-sonnet-5-5, review claude-opus-5-5) failed only on the stale-dist test gate: the agent edited hench source without rebuilding dist/. Work is in b8b51e924 (commitMsgWatcherOptions helper + unit test). After rebuilding hench: new and watcher tests 10/10, affected gate 3/3 suites, six static root policy tests pass. b8b51e924 carries no N-DX-Item (runner on main predates the brief's trailer lines); left as is by the operator's decision."
acceptanceCriteria:
  - "Removing the trailers argument from cli-loop's startCommitMsgWatcher wiring fails a test"
  - "That test asserts the watcher receives N-DX-Item: <taskId> for the run's task"
description: "Found by the adversarial review of task a0c1e859 (timer-expiry auto-commit carries hench's trailers). Verdict: should-fix.\n\nScenario: delete `trailers: buildRunTrailers(run, taskId)` from the startCommitMsgWatcher call in packages/hench/src/agent/lifecycle/cli-loop.ts (~2237). Every hench test still passes, and timer-expiry auto-commits go back to having no N-DX-Item, so rex's realized-by edge misses them again. tests/integration/commit-msg-timer.test.ts passes trailers to the watcher directly, so it only proves the watcher's half. Whether cli-loop actually passes them is not tested at all.\n\nReachable: only when hench.commitMsgTimeoutMs > 0 (default 0), on a run that ends abnormally after writing .hench-commit-msg.txt.\n\nOptions:\n(a) Recommended: move the call into a small exported helper, e.g. `commitMsgWatcherOptions(run, taskId, config, projectDir)`, and unit-test its trailers. Cheap, and the cli-loop call site becomes a single line.\n(b) Spy on startCommitMsgWatcher in an existing cli-loop integration harness, if one exists. More faithful, but heavier."
lastModified: "2026-10-09T04:48:17.433Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
