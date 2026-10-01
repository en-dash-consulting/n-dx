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
acceptanceCriteria:
  - "The Live tab appears in the top nav on every page, outside the stage loop, with a dot and count that update without a reload."
  - "Every running hench task and sourcevision analysis can be opened as its own page from the overview, the hover peek and the running-now bar."
  - "With two tasks and an analysis running at once, the operator can move between their pages in one click or with the [ and ] keys."
  - "Every new route deep-links with zero console errors in the navigation contract test, and works under the hub's /p/:id/ base path."
  - "No existing view id, route or redirect changes."
description: "The top nav has three stage tabs (Analysis, Plan, Work, defined in `packages/web/src/viewer/views/stages.ts`) and nowhere to watch work that is in progress: running hench tasks show as a floating worktrees pill on Home, a stuck-run count on the bottom bar and the last output line in the job tray. This feature adds a fourth top-nav tab, Live, that sits after a divider outside the Analysis → Plan → Work loop and lights up from any page. It has a status dot (idle, running, needs attention) and a count, and a hover peek listing what is live.\n\nLive has an overview page (`/live`) and one page per running item: a task page (`/live/task/:taskId`, under the `/w/<key>/` prefix for another worktree) with Work, Log and, for runs started with `--review`, Review tabs; and a sourcevision analysis page (`/live/analyze`) with the six phases, the enrichment passes inside the zones phase, time against the last run and model spend. When several things run at once, a running-now bar on every Live page switches between them without going back to the overview. This feature covers running work only; finished runs link to Work's existing run history.\n\nGoal: An operator can see at a glance what is running, open any one of several concurrent runs, and follow it step by step until it finishes."
lastModified: "2026-10-01T00:19:02.520Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a running-now bar to every Live page so concurrent runs can be switched without going back](./add-a-running-now-bar-to-every-live.md) | pending |
| [Add Live as a fourth top-nav tab outside the stage loop, with a status dot, count and hover peek](./add-live-as-a-fourth-top-nav-tab.md) | completed |
| [Add the Log tab to the running-task page: the raw terminal stream with follow, filter and search](./add-the-log-tab-to-the-running-task.md) | pending |
| [Add the Review tab to the running-task page for runs started with --review](./add-the-review-tab-to-the-running-task.md) | pending |
| [Build the Live overview page with machine strip, running cards, worktrees, queue and an idle state](./build-the-live-overview-page-with.md) | completed |
| [Build the live sourcevision analysis page: phases, enrichment passes, estimate, output and model spend](./build-the-live-sourcevision-analysis.md) | pending |
| [Build the running-task page with the Work tab: step stream, criteria, runs, location and spend](./build-the-running-task-page-with-the.md) | pending |
| [Point the Home worktrees pill and the bottom-bar analysis and stuck-run badges at Live](./point-the-home-worktrees-pill-and-the.md) | pending |
