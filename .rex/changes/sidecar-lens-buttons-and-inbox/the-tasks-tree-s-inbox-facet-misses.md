---
id: "40e8886f-b154-4533-b6b0-5c77ba1faf9c"
type: "task"
title: "The Tasks tree's Inbox facet misses Inbox changes on a tree with no live capability"
slug: "the-tasks-tree-s-inbox-facet-misses"
description: "Scenario: a v2 tree whose product layer has no capability or constraint, plus one open change with needsPlacement. The Inbox section, /api/status and get_prd_status all count it (isInboxChange), but the Tasks tree's Inbox facet (packages/web/src/viewer/views/prd.ts:66 pickInboxIds) filters on `awaitsPlacement`, which is false there, so the facet is empty and hidden. Reachable on any fresh v2 project before its first capability. Verdict should-fix (low): wrong filter on an edge path, no data loss. Fix: filter on the rows' `inbox` flag instead of `awaitsPlacement` (one line plus a facet-filter-inbox test); keep `awaitsPlacement` where the hold itself matters (change-placement inInbox, changes view NeedsPlacement). Found by the adversarial review of task 6917ec09."
acceptanceCriteria:
  - "On a tree with no live capability, the Tasks tree's Inbox facet lists every open change with needsPlacement (viewer test)"
  - "The facet's ids equal the Inbox section's rows on the same /api/rex/changes read"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
