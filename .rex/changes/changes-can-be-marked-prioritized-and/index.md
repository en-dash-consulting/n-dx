---
id: "77f407be-8f0f-40bf-b56f-9e6800e087c8"
type: "change"
title: "Changes can be marked prioritized, and the Inbox sorts by it"
slug: "changes-can-be-marked-prioritized-and"
summary: "Large pieces of work can be flagged as prioritized, and the Inbox and backlog list prioritized items first, then everything else from most to least important. The team sees what matters first without sorting by hand."
intent: "Bigger PRD items (changes on v2, epics on v1) need a prioritized concept on top of the critical/high/medium/low priority level, to drive sorting. Add an optional prioritized flag to change intent (schema, store, CLI `rex edit`, MCP `edit_item`/`add_item`, dashboard toggle). The Inbox and the backlog/Open changes lists sort prioritized items first, then by priority critical → high → medium → low (missing priority treated as medium), and only then by the existing placement-guess order (sortInbox in packages/web/src/viewer/views/inbox.ts). Tasks inherit the sort position of their change in work selection only if that is already the rule; this change does not alter get_next_task."
acceptanceCriteria:
  - "A change can carry an optional prioritized flag, stored in its intent and round-tripped by the v2 store"
  - "The flag can be set and cleared from the dashboard, the rex CLI and the rex MCP add_item/edit_item tools"
  - "The Inbox lists prioritized changes first, then by priority critical, high, medium, low, then by the existing placement-guess order"
  - "The backlog / Open changes list uses the same ordering"
  - "Prioritized changes are visibly marked in the Inbox and backlog rows"
  - "Unit tests cover the ordering, including missing priority and ties"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "high"
tags:
  - "web"
  - "rex"
  - "plan"
  - "inbox"
source: "ndx-capture"
---
