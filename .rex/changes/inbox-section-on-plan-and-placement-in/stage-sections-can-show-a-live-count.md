---
id: "b140b377-b5af-4498-9b38-eb70ddf13947"
type: "task"
title: "Stage sections can show a live count and open while non-empty"
slug: "stage-sections-can-show-a-live-count"
description: "`Section` in `views/stage-pages.ts` renders a static title and blurb, and mounts the view only while open, so a collapsed section can't show a count from its own view. Add an optional `badge` to `StageSection` in `views/stages.ts` naming a count read from project status (`useProjectStatus`, already used by stage-pages), rendered after the title as an orange count pill with an accessible label (\"19 changes in the Inbox\"). Add an `openWhenNonEmpty` option: the section opens by default while the count is above zero, unless the user's stored open state (`ndx.stage-sections` in localStorage) says otherwise. Use both for the Inbox section only; other sections are unchanged."
acceptanceCriteria:
  - "The Inbox section header shows the open Inbox count from /api/status while collapsed"
  - "The count updates after a placement without a page reload (rex:prd-changed refetch)"
  - "The section opens by default while non-empty and respects a stored open/closed choice"
  - "Other stage sections render as before (stage-page snapshot unchanged for them)"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
