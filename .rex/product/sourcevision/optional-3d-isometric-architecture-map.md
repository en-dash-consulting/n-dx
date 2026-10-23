---
id: "f666d3ed-3625-4468-8048-b9cd6b5fe011"
type: "capability"
title: "Optional 3D isometric architecture map generator"
slug: "optional-3d-isometric-architecture-map"
statement: "Sourcevision renders, on explicit request, a standalone interactive isometric architecture map of the analyzed application as a single HTML file."
criteria: [{"id":"c1","text":"When the user runs the opt-in isometric map command, sourcevision shall write a standalone HTML file such as `.sourcevision/iso-map.html` that has no external runtime dependencies."},{"id":"c2","text":"The isometric map generator shall derive its nodes from the analyzed zones or packages."},{"id":"c3","text":"The isometric map generator shall size each node's height from its zone metrics (file count or LOC)."},{"id":"c4","text":"The isometric map generator shall color each node by its archetype or tier."},{"id":"c5","text":"The isometric map shall render import-graph edges as flow connectors between nodes."},{"id":"c6","text":"When the user clicks a node, the isometric map shall open a detail panel showing the zone summary, key files, findings and cross-zone edges."},{"id":"c7","text":"The isometric map shall let the user pan and zoom the view."},{"id":"c8","text":"The isometric map shall display a legend explaining its node colors."},{"id":"c9","text":"When `sourcevision analyze` runs with its default options, sourcevision shall not generate the isometric map."}]
tags:
  - "sourcevision"
  - "visualization"
  - "isometric"
  - "cli"
source: "ndx-capture: user request referencing /Users/nick/Downloads/anchorpay-map.html isometric SVG technique"
priority: "medium"
---

Add an opt-in sourcevision generator (e.g. `sv iso` or an `--iso` flag) that renders an interactive, self-contained isometric SVG map of the analyzed application, modeled on the technique in anchorpay-map.html (Downloads reference): grid-placed extruded 3D boxes via a vanilla-JS isometric projection, color-coded by kind, with pan/zoom, a legend, and click-to-inspect detail panels — no three.js/d3 or any external runtime dependency.

Nodes are derived from sourcevision's existing analysis outputs: zones (Louvain communities), import graph, file inventory, and component catalog. Box footprint/height map from zone metrics (file count / LOC); color maps from archetype/tier. Detail panels surface the zone summary, key files, findings, and cross-zone edges. Import-graph edges render as flow connectors between nodes.

Scope also includes a data-flow gap analysis: identify what signals the isometric view needs that current analysis does not capture (data-flow direction, entry points, runtime stores/queues, external systems) and gather them via the existing analyze pipeline or AI enrichment. Output is a standalone HTML file (e.g. `.sourcevision/iso-map.html`) generated only when explicitly requested — never part of default analyze.
