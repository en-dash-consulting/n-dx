---
id: "3dcb6301-dd80-41a3-9929-ee2977c57eca"
type: "task"
title: "Open-changes glance panel on Plan"
slug: "open-changes-glance-panel-on-plan"
description: "A new StagePanelId `changes-glance` for the Open changes tile: placed open changes grouped by planned release, newest first, Unscheduled last, each row with a progress bar, a stage chip in rex's words and at most one gap chip (blocked before no criteria). Long lists end in \"N more\". The full-screen tabs (List, Tree) stay."
acceptanceCriteria:
  - "Rows group by planned release with Unscheduled last"
  - "Each row shows progress, a stage chip and at most one gap chip, blocked taking precedence"
  - "Inbox changes are not listed here"
  - "A row opens the change's detail panel"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "231adb0e-64e8-401c-91ed-c6ca8e30f5ad"
  - "4c55d13a-5799-4158-bbe2-bcaf30ddaede"
---
