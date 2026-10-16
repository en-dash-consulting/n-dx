---
id: "1ed4d2ef-d06f-4485-8f07-1d98d1919c76"
level: "task"
title: "Floating status pills share one dock instead of overlapping"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
source: "ndx-capture"
startedAt: "2026-10-15T03:57:50.506Z"
completedAt: "2026-10-15T04:01:33.841Z"
endedAt: "2026-10-15T04:01:33.841Z"
resolutionType: "code-change"
resolutionDetail: "Status dock row with popovers above each pill"
acceptanceCriteria:
  - "The floating status pills sit in one bottom-right dock, stacked without overlapping each other."
  - "They share one visual style (size, border, radius, typography)."
  - "An opened popover from one pill does not cover another pill, and the dock does not cover the bottom bar."
description: "The git-status pill (\"8 uncommitted files\", components/git-status-banner.ts) and the active-operations pill (\"1 running\", components/active-operations-tray.ts) are positioned independently at the bottom right: they overlap each other and the page content, differ in style, and the running tray's popover covers the git pill."
lastModified: "2026-10-15T04:01:34.126Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
