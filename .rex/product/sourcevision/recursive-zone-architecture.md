---
id: "epic-recursive-zone-arch"
type: "capability"
title: "Recursive zone architecture"
slug: "recursive-zone-architecture"
statement: "Sourcevision detects zones with the same full pipeline at every zoom level: it subdivides each zone into sub-zones the same way it analyses the root, lets users drill into sub-zones in the web viewer, and combines several repositories into one workspace."
criteria: [{"id":"c1","text":"When sourcevision subdivides a zone, the subdivision shall use the same full Louvain pipeline as root analysis."},{"id":"c2","text":"When sourcevision subdivides a zone, it shall compute the crossings between the resulting sub-zones."},{"id":"c3","text":"The web viewer shall let users drill down from a zone into its sub-zones."},{"id":"c4","text":"While a user explores sub-zones, the web viewer shall show breadcrumb navigation for the current drill-down path."},{"id":"c5","text":"When a user runs `sourcevision workspace` with a list of directories, sourcevision shall make each repository's analysis a top-level zone."},{"id":"c6","text":"When sourcevision builds a workspace, it shall derive cross-repo crossings by resolving external imports."}]
tags:
  - "sourcevision"
  - "zones"
  - "architecture"
---

Make subdivision use the same full pipeline as root analysis. Same algorithm at every zoom level — fractal zones. Zone detection currently lumps components, routes, utils, and configs into mega-zones because subdivideZone() runs a stripped-down Louvain without resolution escalation, proximity edges, or splitLargeCommunities.
