---
id: "8df7dc0a-b6ac-4a8a-85a5-e64e9442070b"
level: "task"
title: "Review-repair commits carry the N-DX-Item trailer"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-09T03:24:43.711Z"
completedAt: "2026-10-09T03:32:11.984Z"
endedAt: "2026-10-09T03:32:11.984Z"
resolutionType: "code-change"
resolutionDetail: "Verified and closed by the operator. Run 31bed159-073b-4584-a101-f0624ca05017 (claude-sonnet-5-5, review claude-opus-5-5) failed only on the stale-dist test gate: the agent edited hench source without rebuilding dist/. Work is in 3ef649fef. After rebuilding hench: review-repairs.test.ts 11/11, affected gate 3/3 suites, six static root policy tests pass; git's parser reads N-DX-Item on the commit in one final block."
acceptanceCriteria:
  - "The repair commit's `git log -1 --format='%(trailers:key=N-DX-Item,valueonly)'` is the task id (test, through git's parser)"
  - "N-DX, N-DX-Item and Co-Authored-By sit in one final trailer block on the repair commit (test, through git's parser)"
description: "From Ryan's review of #605 (2026-10-09 00:38Z). packages/hench/src/agent/analysis/review-repairs.ts:153 writes the repair commit's trailers as `N-DX: review-pass repairs (task <id>)` and Co-Authored-By, with no N-DX-Item. A repair commit is for exactly one item, so the one-item rule in packages/core/commit-trailers.js says it carries one; without it rex's computeChangeCommits does not count the repair work toward the item. Example on main: 052c0871b. Emit `N-DX-Item: <taskId>` in the same single final trailer block as N-DX and Co-Authored-By. Assert through git's own trailer parser, never a regex over the message; the test helper written here is reused by the one-final-block task."
lastModified: "2026-10-09T03:32:12.260Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
