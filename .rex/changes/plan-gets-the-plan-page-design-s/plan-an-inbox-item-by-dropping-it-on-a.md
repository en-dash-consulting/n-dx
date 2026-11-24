---
id: "aa011302-421a-4c32-b2b4-e162aa7833d4"
type: "task"
title: "Plan an Inbox item by dropping it on a product area, or by its 'Plan in <area>' button"
slug: "plan-an-inbox-item-by-dropping-it-on-a"
summary: "Inbox items can be dragged onto a product-area box, or planned with a one-click button naming the suggested area, so placing work on the product map takes one move instead of opening the placement form."
description: "Design: Inbox rows are draggable (grip handle), each area box is a drop zone ('Drop an inbox item here to plan it in this area') that highlights while dragged over, and each row has a 'Plan in <suggested area>' button. Wire both to the existing placement (place_change via the dashboard's placement route): a drop on an area places the change on that area's best-matching capability from the shortlist, or opens the placement form scoped to the area when there is no confident match. The suggested area comes from the existing placement shortlist. A keyboard path (the button) must exist, since drag alone is not accessible."
acceptanceCriteria:
  - "Dragging an Inbox item over an area box highlights it; dropping places the change in that area (or opens the area-scoped placement form when no capability fits)"
  - "Each Inbox row has a 'Plan in <suggested area>' button that places it the same way"
  - "Placing from Plan uses the existing placement route and refreshes the Inbox and areas"
  - "Unit tests cover the button path and the drop handler"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "3e63dc6a-0686-4785-af01-914d4d1df344"
---
