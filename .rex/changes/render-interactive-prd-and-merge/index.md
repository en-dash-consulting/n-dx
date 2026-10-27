---
id: "72855b7e-99c5-47cb-a742-45a160e0cf58"
type: "change"
title: "Render interactive PRD-and-merge context graph in the dashboard"
slug: "render-interactive-prd-and-merge"
intent: "Build a new dashboard view that renders the PRD tree as a force-directed or hierarchical context graph with merge commit nodes attached to the PRD items they implemented. Users should be able to pan, zoom, select a merge node to see the files it added/changed, and filter by epic, feature, or time range. This gives users a single visual surface to understand how code shipped into the repo maps back to planned work."
acceptanceCriteria:
  - "New route in the dashboard renders PRD items and merge commits as a connected graph"
  - "Clicking a merge node shows the list of files added, modified, and deleted in that merge"
  - "Clicking a PRD node highlights all merges that contributed to it"
  - "View supports filtering by epic, feature, date range, and completion status"
  - "Graph degrades gracefully for repos with no merge history and for PRD items with no associated merges"
  - "View is reachable from the existing PRD tree view with a clear toggle or link"
touches:
  - "a32f8a34-2c34-4ea1-9652-d85d0ba4e8d2"
priority: "high"
tags:
  - "web"
  - "frontend"
  - "viewer"
  - "ui"
source: "smart-add"
---
