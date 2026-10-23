---
id: "cccbd450-bb82-4245-a054-50fc6dc07874"
type: "change"
title: "Reusable dashboard tile grid with in-place and full-screen expansion"
slug: "reusable-dashboard-tile-grid-with-in"
intent: "A layout component for stage pages: a responsive grid of tiles, each with a header (label, glyph, open-page link), a summary body, and two expansion levels. Clicking a tile expands it in place to full grid width showing the real view; a full-screen control opens it over the page, closed with Esc or the close button. Expanded state is remembered per tile. Driven by stage data in views/stages.ts so the page arrangement stays one edit."
acceptanceCriteria:
  - "A stage page can declare tiles with a size (hero, wide, normal) and render them as a responsive grid that collapses to one column at phone width."
  - "Clicking a tile expands it to full grid width showing the real view; clicking its collapse control returns it."
  - "A full-screen control opens the tile's view over the page; Esc and the close button close it and restore focus."
  - "Expanded tiles are remembered per stage across reloads, with storage failures tolerated."
priority: "high"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
---
