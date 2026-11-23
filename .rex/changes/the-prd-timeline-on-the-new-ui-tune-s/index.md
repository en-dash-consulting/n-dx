---
id: "135930a9-e370-4bcc-a736-6bab7d34ee87"
type: "change"
title: "The PRD timeline on the new UI: Tune's Shipped tile and a Tree | Timeline switch on the Tasks page"
slug: "the-prd-timeline-on-the-new-ui-tune-s"
summary: "Shows what was finished when, laid out along a timeline with the work still open beside today, on Work › Tune and as an alternative to the tree on the Tasks page."
intent: "Ports the uncommitted timeline work from the prd-timeline worktree (timeline-graph model and component, Tree | Timeline switch on the PRD view) onto the redesigned UI. The user chose to show it both as the Tasks page's second arrangement and as Work › Tune's Shipped tile, which keeps the Merge Graph as its second full-screen tab. Styling follows the viewer's rules (no coloured left stripes)."
acceptanceCriteria:
  - "The Tasks page has a Tree | Timeline switch, remembered per browser; the timeline replaces the tree and the old completion list"
  - "Work › Tune's Shipped tile shows the timeline; opened full-screen its tabs are Timeline then Graph"
  - "An item in the Shipped tile opens on the Tasks page; on the Tasks page it opens the detail panel"
  - "Tests cover the model, the switch and the tile"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
tags:
  - "web"
  - "timeline"
source: "ndx-capture"
---
