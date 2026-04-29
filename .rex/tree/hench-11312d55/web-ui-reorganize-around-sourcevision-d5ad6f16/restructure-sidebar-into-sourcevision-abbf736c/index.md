---
id: "abbf736c-5dfb-42b9-a67b-867f52c1be2c"
level: "task"
title: "Restructure sidebar into SourceVision / Rex / Hench sections"
status: "completed"
priority: "high"
tags:
  - "web"
  - "sidebar"
  - "navigation"
startedAt: "2026-02-09T18:08:32.225Z"
completedAt: "2026-02-09T18:08:32.225Z"
acceptanceCriteria: []
description: "Replace the current \"Analysis\" and \"Enrichment\" sidebar groupings with three tool-based sections: SourceVision (codebase analysis), Rex (PRD and task management), and Hench (execution). Each section gets its own header and icon treatment in the sidebar. SourceVision and Rex are the two major sections; Hench is smaller."
---

## Subtask: Replace Analysis/Enrichment grouping with tool-based section headers

**ID:** `b55eac06-5884-43a5-9601-df0cfa39cbe2`
**Status:** completed
**Priority:** high

Refactor sidebar.ts to replace the current "ANALYSIS" and "ENRICHMENT" section headers with "SOURCEVISION", "REX", and "HENCH" sections. SourceVision gets: Overview, Import Graph, Zones, Files, Routes, and the enrichment views (Architecture, Problems, Suggestions — still gated by pass level). Rex gets: Dashboard, Tasks, Validation, Token Usage. Hench gets: Runs.

---

## Subtask: Update hash routing to support new view organization

**ID:** `a7bd6e78-67b7-4cff-b063-b2449debddeb`
**Status:** completed
**Priority:** high

Update the route handling in main.ts to support new views (rex-dashboard, hench-runs) and ensure existing hash routes still work. The #prd route should stay as-is for the task tree, add #rex-dashboard for the new Rex overview, and #hench-runs for Hench. Ensure back/forward navigation works correctly.

---
