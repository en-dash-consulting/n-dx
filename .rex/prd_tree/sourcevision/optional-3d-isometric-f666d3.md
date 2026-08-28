---
id: "f666d3ed-3625-4468-8048-b9cd6b5fe011"
level: "feature"
title: "Optional 3D isometric architecture map generator"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "visualization"
  - "isometric"
  - "cli"
source: "ndx-capture: user request referencing /Users/nick/Downloads/anchorpay-map.html isometric SVG technique"
acceptanceCriteria:
  - "Opt-in command or flag (e.g. `sv iso`) produces a standalone HTML file such as `.sourcevision/iso-map.html` with zero external runtime dependencies"
  - "Nodes are derived from zones/packages with dimensions mapped from metrics (file count/LOC → height) and color mapped from archetype/tier"
  - "Import-graph edges are rendered as flow connectors between nodes"
  - "Each node has a click-to-inspect detail panel showing zone summary, key files, findings, and cross-zone edges"
  - "Pan/zoom and legend interactions comparable to the anchorpay-map.html reference"
  - "Data-flow gap analysis is documented: which signals beyond current analysis outputs are needed (data-flow direction, entry points, runtime stores/queues, external systems) and how they are gathered"
  - "Isometric generation is never triggered by default `sourcevision analyze` runs"
description: "Add an opt-in sourcevision generator (e.g. `sv iso` or an `--iso` flag) that renders an interactive, self-contained isometric SVG map of the analyzed application, modeled on the technique in anchorpay-map.html (Downloads reference): grid-placed extruded 3D boxes via a vanilla-JS isometric projection, color-coded by kind, with pan/zoom, a legend, and click-to-inspect detail panels — no three.js/d3 or any external runtime dependency.\n\nNodes are derived from sourcevision's existing analysis outputs: zones (Louvain communities), import graph, file inventory, and component catalog. Box footprint/height map from zone metrics (file count / LOC); color maps from archetype/tier. Detail panels surface the zone summary, key files, findings, and cross-zone edges. Import-graph edges render as flow connectors between nodes.\n\nScope also includes a data-flow gap analysis: identify what signals the isometric view needs that current analysis does not capture (data-flow direction, entry points, runtime stores/queues, external systems) and gather them via the existing analyze pipeline or AI enrichment. Output is a standalone HTML file (e.g. `.sourcevision/iso-map.html`) generated only when explicitly requested — never part of default analyze."
---
