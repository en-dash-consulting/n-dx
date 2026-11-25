---
id: "667a5c44-92bb-410f-b10b-b2f30b4defed"
type: "task"
title: "Show waiting-on dependencies in ndx status for items that are not yet marked blocked"
slug: "show-waiting-on-dependencies-in-ndx"
summary: "Make the status view show which pending items are still waiting on others, so a planned order is visible."
description: "blockedBySuffix (packages/rex/src/cli/commands/status-shared.ts) only prints `(blocked by: …)` when status is `blocked`. For a pending or in-progress item whose blockedBy contains an item that is not completed, print a waiting marker naming the open blockers (by title or display id, whichever status already uses), and none once all blockers are done. Within a parent, order siblings so an item comes after the siblings it waits on (a stable topological order, falling back to the current order for unrelated siblings and for cycles). Apply to text and tree output; JSON output gains an optional `waitingOn` list rather than changing existing fields."
acceptanceCriteria:
  - "A pending task blocked by an open sibling shows a waiting marker naming that sibling in ndx status"
  - "Once the blocker completes, the marker is gone"
  - "Siblings with a dependency chain A→B→C list in that order regardless of titles"
  - "A cycle does not hang or drop items"
  - "ndx status --format=json adds waitingOn and leaves existing fields unchanged"
priority: "low"
tags:
  - "rex"
  - "status"
source: "ndx-capture"
---
