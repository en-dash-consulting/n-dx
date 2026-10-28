---
id: "9edad54b-76d5-402a-a6bc-67a77229b43c"
type: "change"
title: "Changes view holds up at 1,390 changes"
slug: "changes-view-holds-up-at-1-390-changes"
intent: "Follow-up to issue #873 (decision IB11). Checked on the live dashboard 2026-10-27: the Changes view (`packages/web/src/viewer/views/changes.ts`, grouping in `views/product-model.ts` `groupChangesByRelease`) renders all 1,390 changes at once, releases oldest first (0.6.0 at the top), every change with its full description verbatim, many of them multi-paragraph. \"Unscheduled\" alone holds 1,336 changes (1,241 applied). The first open change needing placement is about 5,500px down. Open work, the reason to visit, is buried under applied history.\n\nMake it a planning view again: newest release first with open work leading; applied changes collapsed per group behind a count; descriptions clamped to two lines with an expand control; filters for open, applied and release; and only expanded groups rendered.\n\nShares `views/changes.ts` with the Inbox PR (21a8d036), which changes the Needs placement tag, so it waits for that one."
acceptanceCriteria:
  - "Releases list newest first and open changes lead each group"
  - "Applied changes are collapsed per group behind a count and expand on request"
  - "Descriptions show two lines with an expand control"
  - "Open / Applied / release filters work and the first screen of the view on this repo shows open work"
  - "Collapsed groups do not render their rows"
  - "Changeset bumps @n-dx/web as patch"
touches:
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
tags:
  - "web"
  - "changes-view"
  - "issue-873"
source: "ndx-capture"
blockedBy:
  - "21a8d036-41d6-45fb-b10c-181f074f3e4f"
---
