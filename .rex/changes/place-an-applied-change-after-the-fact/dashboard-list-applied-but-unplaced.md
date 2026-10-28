---
id: "fe7b26c2-a61f-4ab2-9c0b-247d237d83d1"
type: "task"
title: "Dashboard: list applied-but-unplaced changes and place them from the detail panel"
slug: "dashboard-list-applied-but-unplaced"
description: "The Inbox section (PR 3, `views/inbox.ts`) shows \"N applied changes were never placed\" as a collapsed line. Make it expand to a list of those changes (title, applied date, best guess and strength). Clicking one opens its detail panel, whose Where it goes section (`components/prd-tree/change-placement.ts`) offers touches only for an applied change, with the note \"Links this finished change to what it built; its tasks are done.\" Place & next walks this list rather than the open Inbox. The open Inbox count is unchanged."
acceptanceCriteria:
  - "The applied-but-unplaced line expands to a list of those changes"
  - "Their detail panel offers touches only, with the explanatory note"
  - "Placing one removes it from the list and lowers the appliedUnplaced count"
  - "Component tests cover the list and the touches-only panel"
priority: "low"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
