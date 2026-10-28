---
id: "9637b970-57b6-4306-afc6-63e4a213b19a"
type: "task"
title: "Sidecar planning ends in one editable change-set card"
slug: "sidecar-planning-ends-in-one-editable"
description: "Story 11 (CAOS https://www.notion.so/3f7a80b7192481a1ace0c96947b08d57), plus task 21fe75a3 for propose_prd_change, which the broker never allow-lists (sidecar/broker-policy.ts). On approval the card writes through the path the server already uses for PRD adds and placements (routes-rex/items.ts, routes-rex/placement.ts), under the PRD lock (store.withTransaction, or withPrdModelTransaction on v2). v1: each item is added as add_item does. v2: one change with its tasks, placed when the card names a target. The Place lens is not built yet, so an untargeted change lands in the Inbox needing placement and the card says so before approval; the hand-off to the Place lens comes with batch L2. apply_change is never offered from the card. Duplicates: each proposed item that matches an existing item is flagged with the match. Each item's title, description and done-when are editable on the card, and approval writes the edited values. UX5 ghost rows: while the card waits, the Plan tree shows each proposed item as a dimmed 'proposed' row under its parent, which goes away on deny and is replaced by the real item on approval. The generic card bodies from M2 (story 08) stay for other kinds. Mock: Plan board."
acceptanceCriteria:
  - "Approving a change-set card writes its items through the server's existing PRD add and placement path under the PRD lock, and the tool result lists the ids written (tested)"
  - "On a v1 tree each item is added as add_item does; on a v2 tree the card writes one change with its tasks and places it when the card names a target (tested on both)"
  - "A change with no target lands in the Inbox needing placement, and the card says so before approval (tested)"
  - "Each proposed item that matches an existing item is flagged on the card with the match (tested)"
  - "Each item's title, description and done-when can be edited on the card, and approval writes the edited values (tested)"
  - "While the card waits, the Plan tree shows its items as ghost rows that go away on deny and are replaced by the real items on approval (tested)"
  - "The card never offers apply_change, and a denied or withdrawn card writes nothing (tested)"
priority: "high"
source: "caos"
---
