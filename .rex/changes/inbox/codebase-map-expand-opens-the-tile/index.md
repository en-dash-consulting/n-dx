---
id: "44490502-e796-4024-b2cb-c8309d44c5aa"
type: "change"
title: "Codebase map Expand opens the tile modal, not browser full screen"
slug: "codebase-map-expand-opens-the-tile"
intent: "User (2026-10-15): \"on the Codebase map, the button for Expand shouldn't take me to Full Screen of the browser.. should behave like the others.\" IsoMapHero's Expand uses the Fullscreen API. On the dashboard the map is a chromeless tile; its Expand should open the same modal the other tiles open, with the map filling it, wheel zoom on, no duplicate title, and no Expand button inside. Elsewhere (no dashboard) the hero keeps its own full screen."
acceptanceCriteria:
  - "On the Analysis dashboard, the map's Expand opens the tile modal (with the back trail and close), not browser full screen."
  - "In the modal the map fills the body, zooms on a plain wheel, and shows no Expand button or second title."
  - "Outside the dashboard, IsoMapHero's Expand behaves as before."
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
  - "iso-map"
source: "ndx-capture"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Isometric map: single source of truth, declared architecture, dashboard view" (79ff43cf-43e9-4615-9227-31eb90b2d10f).
