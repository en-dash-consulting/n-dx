---
id: "16b0e619-7330-4247-b526-a8148101da4d"
type: "change"
title: "Analysis top row: visuals on the left, recommended fixes on the right"
slug: "analysis-top-row-visuals-on-the-left"
summary: "The Analysis page's top row becomes two panels: one with only the charts and headline numbers, and one listing recommended fixes drawn from the findings. Clicking a highlighted item filters the recommendations, so people move from seeing a problem to the fix in one step."
intent: "Reference: the current Analysis page (screenshot d:\\workspace\\Screenshot 2026-11-18 130718.png) has three tiles across the top (Codebase health, Infrastructure & architecture, Summary), each mixing metrics with a 'What to do' list. Restructure the top row into two tiles. LEFT: all and only the visualizations and basic information: file/zone/circular-dep/cohesion/coupling stats, SDLC readiness, cross-zone imports, infrastructure, the language donut, zone and role bars. Keep the existing highlighting (e.g. the '!' on zones that need attention). Clicking a highlighted element on the page (not inside an expanded tile) filters the recommendations list to that element. RIGHT: recommended work built from the findings (next steps, readiness gaps, files to move) with the fix for each and the existing +PRD action. Those items are highlighted and no longer appear in the left tile. The Codebase map row below stays."
acceptanceCriteria:
  - "The Analysis page's top row has two tiles: visualizations on the left, recommended fixes on the right"
  - "The left tile shows only visualizations and basic statistics, with no 'What to do' lists"
  - "The right tile lists recommended work from the findings (next steps, readiness gaps, files to move), each with its fix and the +PRD action"
  - "Existing highlighting on the left (such as the '!' on zones needing attention) is kept"
  - "Clicking a highlighted element on the page, outside an expanded tile, filters the right tile's list to that element, and the filter can be cleared"
  - "Recommended items appear only in the right tile, not repeated in the left"
  - "The Codebase map row below the top row is unchanged"
  - "Unit tests cover the filter-by-highlight behaviour and the split of content between the two tiles"
touches:
  - "acebe9ce-090f-480e-a9fd-e578f2b34a2b"
priority: "high"
tags:
  - "web"
  - "analysis"
  - "ux"
source: "ndx-capture"
---
