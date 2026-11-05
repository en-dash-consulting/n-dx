---
id: "05eba8de-ab8f-4abe-82da-0e31cf34c494"
type: "task"
title: "Ghost items outside the tree: Open changes, map markers and the strip"
slug: "ghost-items-outside-the-tree-open"
description: "SP5. Extend the Sidecar's ghost rows (ghost-rows.ts, UX5) to every place a change shows on Plan while a change-set card waits: dashed rows in the Open changes glance (\"proposed · on a card\"), a dashed \"+N\" marker on the map block (area or capability) a pending item targets, and a \"+N waiting on a card\" note under the strip's Inbox or Proposed count. Real counts never include them; they vanish on Deny and become real rows once approval writes them."
acceptanceCriteria:
  - "A waiting change-set card's items show as dashed rows in Open changes and as dashed markers on the blocks they target"
  - "The strip shows a +N waiting on a card note and its counts are unchanged"
  - "Deny removes the ghosts; approval replaces them with real items"
priority: "medium"
source: "ndx-capture"
---
