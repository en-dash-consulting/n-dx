---
id: "cf1f496d-ae11-47f0-bba9-9393ab776c06"
type: "task"
title: "Dashboard progress counts a v2 change as an epic: a task-less change shows 0/0 and is left out of the totals"
slug: "dashboard-progress-counts-a-v2-change"
description: "/api/rex/stats and /api/rex/dashboard (packages/web/src/server/routes-rex/reads.ts:158-200) run the v1 computeStats and computeEpicStats on the projected document, where a root change is projected as level epic (packages/rex/src/core/layer-projection.ts:46). computeStats (packages/rex/src/core/stats.ts:31) skips level epic, so a pending change with no tasks counts for nothing. The probe showed 1 total, 1 done and 100% while a pending change was open. computeEpicStats (packages/rex/src/core/analytics.ts:27) lists the change as an epic at 0/0. The viewer hardcodes itemType epic and the 'Epic progress' and 'N epics' labels (packages/web/src/viewer/views/rex-dashboard.ts:200, :471-496). The home Plan card and the status bar read the same totals."
acceptanceCriteria:
  - "On a v2 project a change with no tasks counts as one unit of work in total, pending and percent complete: on the Work page, the home Plan card and the status bar"
  - "On v2 the Work page's progress panel says changes, not epics, and a change with no tasks shows its own status rather than 0/0"
  - "v1 projects show the same numbers and labels as before"
  - "Tests cover a v2 tree with a pending task-less change, a change with tasks, and a completed change"
priority: "high"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
  - "rex"
source: "ndx-capture"
---
