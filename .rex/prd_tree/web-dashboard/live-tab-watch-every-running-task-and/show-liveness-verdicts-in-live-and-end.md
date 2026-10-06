---
id: "ffe5ed2f-62ab-4139-907f-d099aed2f978"
level: "task"
title: "Show liveness verdicts in Live and end dead runs from Needs attention; Work's Active Tasks panel links to Live"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "run-liveness"
  - "adopted-from-pr-484"
blockedBy:
  - "02c5b44e-a84a-4c77-b40c-10febaf2069c"
  - "0803271f-012a-4d7d-8abe-8488cbf8641d"
source: "adopted from draft PR #484 (fix/running-task-audit), adapted to the Live branch's decisions, 2026-10-01"
startedAt: "2026-10-01T21:26:53.696Z"
completedAt: "2026-10-01T21:46:34.317Z"
endedAt: "2026-10-01T21:46:34.317Z"
resolutionType: "code-change"
resolutionDetail: "Live shows liveness verdicts; End N dead runs and per-run End via reconcile route; Active Tasks panel shows verdict + Manage in Live link."
acceptanceCriteria:
  - "Needs attention lists orphaned and unknown runs from every worktree with their reasons (unit test)."
  - "End N dead runs ends only orphaned runs through the reconcile route and asks for confirmation (unit test)."
  - "Unknown runs can be ended one at a time after a confirm; foreign runs have no end action (unit test)."
  - "The Active Tasks panel on Work shows the verdict and links to Live and has no end controls."
description: "Live is where runs are stopped and ended; Work only starts them. Use the verdicts from /api/live:\n- Live overview, Needs attention: list `orphaned` and `unknown` runs (with stale ones) from every worktree, each with its verdict badge and the `livenessReason` text. Adopt #484's labels (`orphaned` → \"Not running\", plus its foreign and unknown wording; `git show refs/review/pr-484:packages/web/src/viewer/components/active-tasks-panel.ts`).\n- An \"End N dead runs\" action calls the reconcile route for the orphaned runs; unknown runs end only one at a time after a confirm that shows the reason. Foreign runs are shown, never endable.\n- The running-now bar, the Live tab badge and the task page use the verdict: an orphaned run shows as not running, not as stuck-but-live.\n- Work's Active Tasks panel (`components/active-tasks-panel.ts`) shows the verdict badge and a \"Manage in Live\" link instead of #484's End buttons and banner, so there is one place that ends runs.\nDo not port #484's Active Tasks panel controls or its hench-runs.css block; reuse live.css."
lastModified: "2026-10-01T21:46:35.265Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
