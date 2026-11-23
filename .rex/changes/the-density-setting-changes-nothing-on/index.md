---
id: "197a5050-b43a-441b-8fde-74180deedec8"
type: "change"
title: "The density setting changes nothing on screen"
slug: "the-density-setting-changes-nothing-on"
summary: "The dashboard's small, medium and large density control is saved but has no visible effect, so people who pick it see nothing change. This makes the setting actually resize text, spacing and rows as it promises."
intent: "Found while working change 064dd7fc: the header's S/M/L density control writes `data-density` on the page root and remembers it, but no stylesheet reads `data-density`, so font sizes, spacing and row heights are identical at every setting (confirmed by measurement). The capability 'UI Density Toggle (Small / Medium / Large)' states the control scales font sizes, spacing and row heights across all views. Wire the attribute to the spacing and type tokens so each setting changes them."
acceptanceCriteria:
  - "Selecting small, medium or large changes font sizes, spacing and row heights across dashboard views"
  - "The scaling is driven by the data-density attribute through the shared design tokens, not per-view overrides"
  - "Tile gaps and row heights scale with density without pages scrolling sideways"
  - "A test fails if no stylesheet rule depends on data-density"
touches:
  - "6f1c5031-4fb4-4a9c-8560-64f11d55732f"
priority: "medium"
discoveredFrom: {"item":"064dd7fc-e4e9-4314-ab8b-6e9399485dc7"}
tags:
  - "web"
  - "css"
  - "bug"
source: "ndx-capture"
---
