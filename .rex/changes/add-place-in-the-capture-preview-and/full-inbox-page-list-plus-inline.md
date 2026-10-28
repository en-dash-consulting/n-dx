---
id: "2bdda5a6-d7b9-498b-ae07-a75d55f84ef9"
type: "task"
title: "Full Inbox page: list plus inline placement, Place & next, keyboard"
slug: "full-inbox-page-list-plus-inline"
description: "The `inbox` view's own page (reached from \"Open ↗\" on the Plan section and from the bottom-bar pill): a breadcrumb \"Plan › Inbox · N to place · M placed this visit\", a list on the left (title, strength, task count, deferred tag) in the IB7 order, and the selected change's Where it goes section (`components/prd-tree/change-placement.ts` from PR 3) inline on the right. Place & next is the default action.\n\nKeyboard: J/K move, 1–5 pick a candidate, T/A set touches/amends, Enter place and next, S skip, N nothing fits, / search. Shortcuts are inactive while typing in a field and are listed on the page. Skip leaves the change in the Inbox and moves on."
acceptanceCriteria:
  - "Open ↗ opens the page with the list and the inline placement section"
  - "Place & next places the selected change and selects the next one"
  - "Each shortcut works and none fires while a text field has focus"
  - "The page states how many were placed this visit"
  - "View tests cover selection, the shortcuts and skip"
priority: "medium"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
