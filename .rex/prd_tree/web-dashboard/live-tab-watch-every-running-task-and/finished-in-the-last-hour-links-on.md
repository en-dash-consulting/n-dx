---
id: "0a0da654-6924-46dc-960a-9bd1e8105db6"
level: "task"
title: "\"Finished in the last hour\" links on /live open another worktree's run in the current workspace, which answers not found"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
startedAt: "2026-10-01T19:38:26.249Z"
completedAt: "2026-10-01T19:44:00.851Z"
endedAt: "2026-10-01T19:44:00.851Z"
resolutionType: "code-change"
resolutionDetail: "Recent-run links on /live now use liveHref/isCurrentWorktree, so another worktree's run opens under /w/<key>/hench-runs/<id>. Commit db620f925."
acceptanceCriteria:
  - "A finished run from another worktree links to that worktree's run detail under /w/<key>/ (unit test)."
  - "A finished run from the served worktree still links without a /w/ prefix."
description: "Failure: `packages/web/src/viewer/views/live.ts:333` calls `navigateTo(\"hench-runs\", {runId})`, but the server's `recent` list covers every worktree (`routes-live.ts:409-470`). When worktree B finishes a run and the operator clicks it on the anchor's /live, the anchor's /hench-runs/<id> answers not found. Queue links (`live.ts:296`) read the viewer's own workspace and are correct.\n\nReachability: any multi-worktree repository. Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: build the link with the run's worktree through `liveHref` (as the running-now bar does), so it opens under /w/<key>/hench-runs/<id>. Small."
lastModified: "2026-10-01T19:44:01.358Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
