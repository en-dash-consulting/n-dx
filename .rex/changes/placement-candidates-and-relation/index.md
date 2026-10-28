---
id: "620cb6fa-5860-4ad6-b81e-4bbd382775c4"
type: "change"
title: "Placement candidates and relation labels use the panel's text size"
slug: "placement-candidates-and-relation"
intent: "Found checking the #873 stack in the browser. The placement styles in `packages/web/src/viewer/styles/prd-tree.css` set no font size on `.cp-section`, `.cp-form`, `.cp-target` or `.cp-relation`, so candidate titles (`.cp-target-title`) and the Touches/Amends labels inherit the browser default 16px. The rest of the detail panel reads 13px (`--font-base`, as `.task-description`) and the candidate details 11px (`--font-xs`). At the 280px panel each candidate runs several lines tall.\n\nThe same classes render in the change detail panel, on the Inbox page (`.inbox-detail`) and in the capture Preview card (`smart-add-input.ts` reuses `.cp-target` and `.cp-relation`), so one rule fixes all three. Set `font-size: var(--font-base)` where the placement block starts (`.cp-section, .cp-form`) and on `.cp-target` and `.cp-relation`, so the Preview, which has no `.cp-section` around it, matches too. Leave `.cp-target-detail` and the other `--font-xs` notes as they are."
acceptanceCriteria:
  - "Candidate titles and the Touches/Amends labels compute to var(--font-base) (13px) in the detail panel, on the Inbox page and in the capture Preview card"
  - "Candidate details stay at var(--font-xs)"
  - "Nothing in the detail panel overflows at the 320px and 280px panel widths"
  - "A CSS or viewer unit test fails if .cp-target loses its font size"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "797fa0aa-caa0-433f-aa50-de87f0c05e90"
priority: "medium"
discoveredFrom: {"item":"21a8d036-41d6-45fb-b10c-181f074f3e4f"}
tags:
  - "inbox-placement"
  - "web"
  - "layout"
source: "ndx-capture"
---
