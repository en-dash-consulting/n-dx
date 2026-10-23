---
id: "d5ad6f16-156d-496f-99e5-0230dd48cd47"
type: "capability"
title: "Web UI: Reorganize around SourceVision / Rex / Hench sections"
slug: "web-ui-reorganize-around-sourcevision"
statement: "The web dashboard organizes its sidebar and navigation into three tool-based sections — SourceVision, Rex and Hench — with SourceVision and Rex as the major sections and Hench as a smaller section for execution history."
criteria: [{"id":"c1","text":"The web dashboard shall group its sidebar into three tool-based sections, SourceVision for codebase analysis, Rex for PRD and task management, and Hench for execution, instead of \"Analysis\" and \"Enrichment\" groupings."},{"id":"c2","text":"The sidebar shall give each of the SourceVision, Rex and Hench sections its own header and icon."},{"id":"c3","text":"The sidebar shall present SourceVision and Rex as the major sections and Hench as a smaller section."},{"id":"c4","text":"The Rex section shall provide separate views for a PRD dashboard overview, the task tree, validation, and analysis proposals."},{"id":"c5","text":"The web dashboard shall place the Token Usage and Validation views under the Rex section."},{"id":"c6","text":"The Hench section shall show the run history and the status of each run, read from .hench/runs/."},{"id":"c7","text":"The Hench section shall link each run to the Rex task it executed."}]
tags:
  - "web"
  - "ux"
  - "navigation"
priority: "high"
---

Restructure the web dashboard sidebar and navigation so the three tools have clear, distinct sections rather than the current flat "Analysis" + "Enrichment" grouping. SourceVision and Rex are the two major sections; Hench is a smaller section focused on execution history. This replaces the current layout where Rex is just one "Tasks" tab buried among SourceVision views.
