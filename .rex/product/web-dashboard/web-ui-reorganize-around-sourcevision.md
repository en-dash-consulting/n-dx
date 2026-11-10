---
id: "d5ad6f16-156d-496f-99e5-0230dd48cd47"
type: "capability"
title: "Web UI: Reorganize around SourceVision / Rex / Hench sections"
slug: "web-ui-reorganize-around-sourcevision"
statement: "The web dashboard organizes its pages as a loop of four stages (Analysis, Plan, Work and Tune), with Live beside the loop and Settings in an overlay."
criteria: [{"id":"c1","text":"The top navigation shall show the Analysis, Plan, Work and Tune stages in that order."},{"id":"c2","text":"The side stage links shall step through the four stages and wrap from Tune back to Analysis."},{"id":"c3","text":"Live shall appear as its own tab outside the stage loop."},{"id":"c4","text":"Settings shall open as an overlay from the bottom bar, not as a stage."},{"id":"c5","text":"Each stage page shall answer one question: Analysis what the code is, Plan what is changing, Work what goes to the agent next, and Tune how the project's workflow should change."}]
tags:
  - "web"
  - "ux"
  - "navigation"
priority: "high"
---

Restructure the web dashboard sidebar and navigation so the three tools have clear, distinct sections rather than the current flat "Analysis" + "Enrichment" grouping. SourceVision and Rex are the two major sections; Hench is a smaller section focused on execution history. This replaces the current layout where Rex is just one "Tasks" tab buried among SourceVision views.

## History

- 2026-11-05 f5c7b061-22b2-4b84-93cd-55793d328d68 modified: Navigation becomes a loop of four stages with Tune; criteria describe the loop
