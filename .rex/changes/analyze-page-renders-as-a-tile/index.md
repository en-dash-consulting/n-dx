---
id: "fb239feb-b201-4a18-93d0-130371db8c89"
type: "change"
title: "Analyze page renders as a tile dashboard with the iso map as hero"
slug: "analyze-page-renders-as-a-tile"
intent: "Switch the Analyze stage from stacked collapsible sections to the tile grid. The isometric map is the hero tile across the top. Overview's pieces (stats, Next steps, languages) and the views (Problems, Suggestions, Zones, Files, Architecture with Routes, PR markdown, Ask) become tiles. The Terrain group is removed; Zones becomes its own tile and the flat Graph view leaves the Analyze page (its /graph route and full page remain). Feature gates and requiresServer/hiddenWhenDeployed still apply per tile."
acceptanceCriteria:
  - "/analyze shows the iso map as the top hero tile followed by tiles for Next steps, Problems, Suggestions, Zones, Files, Architecture, languages/stats, and gated PR markdown and Ask."
  - "No Terrain section remains; the Graph view is absent from the Analyze page but /graph still renders."
  - "Feature-gated and server-only tiles are hidden under the same conditions as today's sections."
  - "Plan and Work pages are unchanged."
touches:
  - "79ff43cf-43e9-4615-9227-31eb90b2d10f"
priority: "high"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
blockedBy:
  - "cccbd450-bb82-4245-a054-50fc6dc07874"
---
