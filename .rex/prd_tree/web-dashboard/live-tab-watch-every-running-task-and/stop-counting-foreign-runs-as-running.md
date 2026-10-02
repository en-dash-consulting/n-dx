---
id: "f9b36652-edd2-45e2-ad07-01780bc6fc32"
level: "task"
title: "Stop counting foreign runs as running in the Live tab and running-now bar"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "pr-review"
source: "PR #496 review, 2026-10-02"
startedAt: "2026-10-02T02:09:14.900Z"
completedAt: "2026-10-02T02:15:35.717Z"
endedAt: "2026-10-02T02:15:35.717Z"
resolutionType: "code-change"
resolutionDetail: "liveRunningCount = liveRunCount (countsAsLive) + counts.jobs; tests + changeset added"
acceptanceCriteria:
  - "With one foreign running record and nothing else, liveRunningCount is 0 and liveTabState is idle (regression unit test)."
  - "With one live run, one foreign and one orphaned record plus one analyze job, liveRunningCount is 2 (unit test)."
  - "The Live tab badge, the running-now bar and the Home pill agree on the running count for the same feed (test or shared helper)."
  - "Changeset for @n-dx/web (patch)."
description: "Found in PR #496 review. `liveRunningCount` in `packages/web/src/viewer/hooks/use-live.ts` (line ~200) computes `live.counts.running + live.counts.jobs - live.runs.filter(isDeadRun).length`, and `isDeadRun` only matches `liveness === \"orphaned\"`. A run judged `foreign` (recorded on another host) therefore still counts as in flight: it raises the Live tab's number, flips `liveTabState` to `running`, and raises the running-now bar's count (`components/live-tab.ts:195`, `views/live-bar.ts:105`). `countsAsLive` (line ~165) already excludes both `orphaned` and `foreign` and is what the worktree count and the Home pill use.\n\nFix: compute the run part of `liveRunningCount` from `live.runs.filter(countsAsLive).length` (the same as `liveRunCount`) plus `live.counts.jobs`, so runs and long jobs still both count; do not subtract from `counts.running`, which includes foreign and orphaned records. Check every other caller of `isDeadRun` and the counts in `use-live.ts` for the same gap. Keep `attentionFlag` behaviour (foreign is not flagged). Run git commands bare from the project root (no `cd …&&`, no `git -C`)."
lastModified: "2026-10-02T02:15:36.115Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
