---
id: "9ccf152a-a51a-4a20-9518-88ea83dee1ec"
type: "task"
title: "A focused stage filters the Inbox panel as well as the areas"
slug: "a-focused-stage-filters-the-inbox"
summary: "Clicking Inbox in How work moves shows only Inbox items and empties the areas; clicking a later stage empties the Inbox panel and focuses the areas."
description: "The shared Plan view's stage gains \"inbox\". Focused on Inbox: the areas list nothing (\"Nothing here for this view\") and the Inbox panel lists its items as usual. Focused on any later stage: the Inbox panel says nothing in the Inbox is at that stage and offers Show all, and the areas list only that stage."
acceptanceCriteria:
  - "Focusing Inbox leaves every area box empty and the Inbox panel unchanged"
  - "Focusing Proposed, Ready, In progress or Awaiting apply empties the Inbox panel with a Show all that clears the focus"
  - "The focus is shared, so the Inbox panel opened after clicking a stage already shows it"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "592a13b5-3386-452e-80cc-89200f0613e8"
---
