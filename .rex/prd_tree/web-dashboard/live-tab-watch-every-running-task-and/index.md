---
id: "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
level: "feature"
title: "Live tab: watch every running task and analysis from one place"
status: "pending"
priority: "high"
tags:
  - "live"
  - "web-viewer"
source: "Live tab design session 2026-09-30; mockups https://claude.ai/artifact/AvLo4pyFzfs9HT2zZaCTE7"
startedAt: "2026-10-01T06:43:42.192Z"
endedAt: "2026-10-01T06:43:42.192Z"
acceptanceCriteria:
  - "The Live tab appears in the top nav on every page, outside the stage loop, with a dot and count that update without a reload."
  - "Every running hench task and sourcevision analysis can be opened as its own page from the overview, the hover peek and the running-now bar."
  - "With two tasks and an analysis running at once, the operator can move between their pages in one click or with the [ and ] keys."
  - "Every new route deep-links with zero console errors in the navigation contract test, and works under the hub's /p/:id/ base path."
  - "No existing view id, route or redirect changes."
description: "The top nav has three stage tabs (Analysis, Plan, Work, defined in `packages/web/src/viewer/views/stages.ts`) and nowhere to watch work that is in progress: running hench tasks show as a floating worktrees pill on Home, a stuck-run count on the bottom bar and the last output line in the job tray. This feature adds a fourth top-nav tab, Live, that sits after a divider outside the Analysis → Plan → Work loop and lights up from any page. It has a status dot (idle, running, needs attention) and a count, and a hover peek listing what is live.\n\nLive has an overview page (`/live`) and one page per running item: a task page (`/live/task/:taskId`, under the `/w/<key>/` prefix for another worktree) with Work, Log and, for runs started with `--review`, Review tabs; and a sourcevision analysis page (`/live/analyze`) with the six phases, the enrichment passes inside the zones phase, time against the last run and model spend. When several things run at once, a running-now bar on every Live page switches between them without going back to the overview. This feature covers running work only; finished runs link to Work's existing run history.\n\nGoal: An operator can see at a glance what is running, open any one of several concurrent runs, and follow it step by step until it finishes."
lastModified: "2026-10-01T15:21:32.839Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a running-now bar to every Live page so concurrent runs can be switched without going back](./add-a-running-now-bar-to-every-live.md) | completed |
| [Add Live as a fourth top-nav tab outside the stage loop, with a status dot, count and hover peek](./add-live-as-a-fourth-top-nav-tab.md) | completed |
| [Add the Log tab to the running-task page: the raw terminal stream with follow, filter and search](./add-the-log-tab-to-the-running-task.md) | completed |
| [Add the Review tab to the running-task page for runs started with --review](./add-the-review-tab-to-the-running-task.md) | completed |
| [Build the Live overview page with machine strip, running cards, worktrees, queue and an idle state](./build-the-live-overview-page-with.md) | completed |
| [Build the live sourcevision analysis page: phases, enrichment passes, estimate, output and model spend](./build-the-live-sourcevision-analysis.md) | completed |
| [Build the running-task page with the Work tab: step stream, criteria, runs, location and spend](./build-the-running-task-page-with-the.md) | completed |
| [Escape does not close the Live tab peek when it was opened by hover](./escape-does-not-close-the-live-tab.md) | pending |
| [Every useLive instance shares the poller key "live", so the first unmount stops polling for the Live tab, badge and pill](./every-uselive-instance-shares-the.md) | completed |
| ["Finished in the last hour" links on /live open another worktree's run in the current workspace, which answers not found](./finished-in-the-last-hour-links-on.md) | completed |
| [Log tab tail reads overlap and append the same chunk twice when a read takes longer than the 500 ms poll](./log-tab-tail-reads-overlap-and-append.md) | completed |
| [Mark stuck on the task page has no confirmation and shows on healthy runs, so one click marks a working run failed](./mark-stuck-on-the-task-page-has-no.md) | completed |
| [Point the Home worktrees pill and the bottom-bar analysis and stuck-run badges at Live](./point-the-home-worktrees-pill-and-the.md) | completed |
| [Show liveness verdicts in Live and end dead runs from Needs attention; Work's Active Tasks panel links to Live](./show-liveness-verdicts-in-live-and-end.md) | pending |
| ["Stop all" on /live is enabled by the repository-wide count but stops only the served worktree's runs](./stop-all-on-live-is-enabled-by-the.md) | pending |
| [Stop on the task page reports "Stopped" when the server only marked the record and sent no signal](./stop-on-the-task-page-reports-stopped.md) | completed |
| [The live-task view with no task id renders a blank page, reachable by closing Settings or deep-linking /live-task](./the-live-task-view-with-no-task-id.md) | completed |
| [The Log tab never shows a log's last line when it has no trailing newline](./the-log-tab-never-shows-a-log-s-last.md) | pending |
| [The Log tab's started line hardcodes "n-dx work --task=… --auto" instead of the project's CLI name and real command](./the-log-tab-s-started-line-hardcodes-n.md) | pending |
