---
id: "9b5e6519-b13e-4ca2-a70a-40988f4dcea8"
type: "change"
title: "Area view: an area's spec map at /product/area/<slug>"
slug: "area-view-an-area-s-spec-map-at"
intent: "Slice S6 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12, section 4b; decisions AD1–AD6). Built on the Sidecar stack.\n\nClicking an area block on Plan's product map zooms into that area: the map tile goes full-screen and draws the area's capabilities as blocks, the spec map. The view has its own route, /product/area/<slug> with the area's frozen v2 slug, so it can be linked and reloaded; opened from Plan, Esc or the breadcrumb returns to Plan where you were, and a deep link opens it on the Product page.\n\nThe view:\n- A header with the area's summary, counts (capabilities, constraints, met, changing, defective, open changes), a steward chip (\"no steward · add\" when none), and actions \"+ Change in this area\" and \"Open on Product page\".\n- A band for each constraint that binds the area.\n- The spec map: one block per capability, sized by its criteria count (thin specs look thin), tinted by computed status, marked with the open change on it. It reuses S3's block component.\n- A right-hand column of four cards: Moving now (open changes touching or amending the area), Waiting in the Inbox (Inbox changes whose best guess is here, each with Place), Recently applied, and Where it lives in code (an empty state with \"Link code from the last analysis\" when no capability lists code).\n- Selecting a capability swaps the column for its detail (statement, criteria, pending amendments, history); Esc steps back to the area.\n\n\"Changed alongside\" is left out: on this repository one bulk migration change touched about 300 nodes, so the co-change counts say nothing until changes above a size threshold are excluded."
acceptanceCriteria:
  - "Clicking an area block on Plan opens /product/area/<slug> in the map tile's full-screen, and Esc returns to Plan at the same scroll"
  - "Loading /product/area/<slug> directly opens the Product page on that area"
  - "The spec map draws one block per capability sized by criteria count, tinted by status, with open-change markers, and a band per binding constraint"
  - "The right-hand column shows Moving now, Waiting in the Inbox, Recently applied and Where it lives in code, each with an empty state"
  - "Selecting a capability block shows its detail in place, and Esc returns to the area"
  - "\"+ Change in this area\" opens capture with the placement shortlist limited to this area's capabilities"
touches:
  - "2e233c46-e4fb-49d1-81e7-6e0fd58fc683"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
  - "product-map"
source: "ndx-capture"
blockedBy:
  - "f86e6895-eaa2-4d7f-85c8-e6964a9b1fa7"
---
