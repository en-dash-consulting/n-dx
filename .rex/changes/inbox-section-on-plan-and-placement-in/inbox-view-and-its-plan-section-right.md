---
id: "ecac94e1-42b4-4b61-829b-6a801dc94ee6"
type: "task"
title: "Inbox view and its Plan section, right after the capture bar"
slug: "inbox-view-and-its-plan-section-right"
description: "Add a view id `inbox`: label \"Inbox\" and blurb \"Changes with no place on the product map yet. ndx work skips their tasks until each is placed.\" in `views/view-meta.ts`, a renderer in `views/view-registry.ts`, a route, and a Plan section in `views/stages.ts` placed after the plain `analysis` lead section and before `prd` (`requiresServer: true`).\n\nNew `views/inbox.ts`: reads `/api/rex/changes` (rows with `awaitsPlacement`) and each change's shortlist from `GET /api/rex/changes/:id/placement` (fetch lazily or batch; 19 rows today). Each row shows title, short id, priority and tags, the best guess with its strength chip (dot + word, never colour alone: strong, possible, weak, tied), and a Place button. Sort strongest first, then possible, tied, weak (IB7). Show five rows and \"N more · Open ↗\". Below, a collapsed line \"N applied changes were never placed (history, can't be placed)\" from `rex.inbox.appliedUnplaced` (IB2). A row or its Place button opens the change's detail panel the way Changes does today (`navigateTo(\"prd\", { taskId })`). At zero: \"Inbox is empty\" (IB9). v1: render nothing (the section is v2-only, like Product and Changes)."
acceptanceCriteria:
  - "Plan lists an Inbox section after the capture bar and before Tasks on a v2 project"
  - "The Inbox section's entry in STAGES.plan sets badge: \"inbox\" and openWhenNonEmpty: true (the mechanism from dc5571a45), so its header shows the open Inbox count and it opens while that count is above zero"
  - "Rows show best guess and strength, sorted strongest first, five shown with a link to the rest"
  - "The applied-but-unplaced count shows collapsed and offers no action"
  - "Clicking a row opens the change's detail panel"
  - "Zero open Inbox changes shows 'Inbox is empty'"
  - "View unit tests cover ordering, the empty state and v1"
priority: "high"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
