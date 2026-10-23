---
id: "1ed4d2ef-d06f-4485-8f07-1d98d1919c76"
type: "change"
title: "Floating status pills share one dock instead of overlapping"
slug: "floating-status-pills-share-one-dock"
intent: "The git-status pill (\"8 uncommitted files\", components/git-status-banner.ts) and the active-operations pill (\"1 running\", components/active-operations-tray.ts) are positioned independently at the bottom right: they overlap each other and the page content, differ in style, and the running tray's popover covers the git pill."
acceptanceCriteria:
  - "The floating status pills sit in one bottom-right dock, stacked without overlapping each other."
  - "They share one visual style (size, border, radius, typography)."
  - "An opened popover from one pill does not cover another pill, and the dock does not cover the bottom bar."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
source: "ndx-capture"
---
