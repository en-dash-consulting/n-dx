---
id: "21a8d036-41d6-45fb-b10c-181f074f3e4f"
type: "change"
title: "Inbox section on Plan, and placement in the change detail panel"
slug: "inbox-section-on-plan-and-placement-in"
intent: "PR 3 of 5 for issue #873: the dashboard half that makes the Inbox findable and placeable. Design (revision 3, checked against the live dashboard) and decisions: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm.\n\nWhat the live dashboard shows today (2026-10-27): the Plan page captures into the Inbox (\"Describe a change for the Inbox…\") but no section is called Inbox. Inbox changes sit in the Tasks tree with no marker. Their detail panel (`components/prd-tree/task-detail.ts`, 320px) says nothing about placement but offers \"+ Add Task\", whose tasks ndx work will refuse. The Changes page has 1,390 rows, oldest release first, and the first open Inbox change is about 5,500px down.\n\nAccepted decisions: IB1, an Inbox section first on Plan plus placement in the change's existing detail panel (no new modal); IB2, the 156 applied-but-flagged changes appear only as a collapsed count; IB3, umbrella changes get \"Place & add another\" (extra touches); IB7, Inbox order strongest match first, weak and tied last; IB9, the section is always on Plan, collapsed with \"Inbox is empty\" at zero.\n\nEvery write goes through PR 2's routes. Nothing is auto-accepted."
acceptanceCriteria:
  - "Plan shows an Inbox section directly after the capture bar, with the open Inbox count in its header, open while non-empty and collapsed with 'Inbox is empty' at zero"
  - "An Inbox change's detail panel has a Where it goes section that places it (touches or amends) or proposes a new home, and Place & next moves to the next Inbox change"
  - "Tasks marks Inbox changes with a badge and can filter to them"
  - "The Plan tab and the bottom bar show the Inbox count from /api/status"
  - "'Needs placement' appears only on open changes"
  - "Changeset bumps @n-dx/web as patch"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "797fa0aa-caa0-433f-aa50-de87f0c05e90"
priority: "high"
tags:
  - "inbox-placement"
  - "issue-873"
  - "web"
source: "ndx-capture"
blockedBy:
  - "77b3224f-68b0-4bd0-9d08-20c42819a9f1"
---
