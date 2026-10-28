---
id: "f86e6895-eaa2-4d7f-85c8-e6964a9b1fa7"
type: "change"
title: "Plan glance tiles: lifecycle strip, product area map, open-changes glance"
slug: "plan-glance-tiles-lifecycle-strip"
intent: "Slice S3 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, decisions PP2, PP8, PP9, PP10).\n\nThree purpose-built panels replace S2's view previews on Plan:\n- A lifecycle strip under the capture bar, in rex's change stages: Inbox, Proposed, Ready, In progress, Awaiting apply, each a count that opens Open changes filtered to it (Inbox opens the Inbox page), then the next pick: its title and why rex picked it, linking to Work with it selected, never a Start button. Ready means rex's `ready` flag; at 0 it says it needs an automated requirement.\n- A product area map: one block per area, sized by capability count, tinted by computed status, with a marker for open changes that touch it; a block opens the Product page at that area.\n- An open-changes glance: placed open changes grouped by planned release, newest first and Unscheduled last, each with a progress bar, its stage chip and at most one gap chip (blocked, else no criteria). A task-less change is not a gap: on v2 it runs as its own unit.\n\nThe glance needs a fast read. On 2026-10-28 GET /api/rex/changes did not answer within 30 seconds on this repository's 1,390 changes, so the tiles get a summary route (or the full route a cache)."
acceptanceCriteria:
  - "Plan shows the lifecycle strip with Inbox, Proposed, Ready, In progress and Awaiting apply counts and the next pick, and each count opens the matching filtered list"
  - "The product tile draws one block per area sized by capability count, tinted by status, with open-change markers, and a block opens that area"
  - "The open-changes tile groups placed open changes by release with a stage chip and at most one gap chip per row"
  - "Plan's glance tiles render from a read that answers in under two seconds on this repository's PRD"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
priority: "medium"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
source: "ndx-capture"
blockedBy:
  - "9e95f7f4-a9ba-4a9a-a66b-300a0d2f7509"
---
