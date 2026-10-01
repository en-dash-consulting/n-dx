---
id: "54a87fd3-07c2-43c5-a94d-ad8cc72aae68"
level: "task"
title: "Count worktrees with a live run, and the Home pill's running count, by liveness verdict instead of run status"
status: "pending"
priority: "medium"
tags:
  - "live"
  - "local-testing"
source: "local testing of PR #496, 2026-10-01"
acceptanceCriteria:
  - "With one live run and one orphaned record in different worktrees, /api/live reports worktrees.withLiveRun = 1 (integration test)."
  - "The Home pill reads \"1 running\" in that state, and the orphaned run still appears under Needs attention (unit test)."
  - "GET /api/worktrees keeps its existing running field; any new count agrees with /api/live for the same moment."
  - "Changeset for @n-dx/web (patch)."
description: "The Live machine strip says \"35 worktrees · 2 with a live run\" and the Home pill says \"35 worktrees · 2 running\" while only one run is executing: the other is an abandoned record whose liveness verdict is `orphaned` (it shows correctly as \"Not running\" in Needs attention). Two counters still go by `status === \"running\"`:\n- `packages/web/src/server/routes-live.ts` around line 466: `liveHere = true` (and `runningCount++`) for any running record, so `machine.worktrees.withLiveRun` counts orphaned runs.\n- `packages/web/src/viewer/components/sessions-panel.ts:60` sums `wt.runs.running` from `GET /api/worktrees` (`server/routes-worktrees.ts`, the shared RunDigest count).\n\nCount a run as live only when its verdict is `live` or `unknown` (the run may still be executing), never `orphaned` or `foreign`; keep reporting orphaned runs as stuck where they are today. For the pill, either add a verdict-aware `live` count to the worktree summary (computed from the same RunDigest plus the liveness verdict, so the two endpoints still agree) or read the count from the Live feed the pill already subscribes to for analyses. Leave the raw `running` field in place for existing readers."
lastModified: "2026-10-01T22:36:05.458Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
