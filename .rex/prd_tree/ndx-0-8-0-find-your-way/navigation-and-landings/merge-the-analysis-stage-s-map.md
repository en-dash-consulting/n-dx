---
id: "a56a8025-c0ba-4e29-a581-d8c79b513472"
level: "task"
title: "Merge the Analysis stage's map, isometric map and zones into one tabbed Terrain section, and Architecture and Routes into one tabbed section"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
blockedBy:
  - "e8fb5412-e393-4e24-a104-8b14194066d1"
source: "caos work management: WM-2117 (Merge Map, Isometric Map and Zones into a tabbed Terrain page and Architecture and Routes into a tabbed Architecture page); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "The Analysis stage shows a Terrain section with Map, Isometric map and Zones tabs and an Architecture section with Architecture and Routes tabs, replacing the four separate sections and the 2D/3D toggle; the tabs are keyboard-operable with tab and tabpanel ARIA."
  - "/graph, /iso-map, /zones, /architecture and /routes still open their full pages, and each section's Open link opens the active tab's view."
  - "The merge-graph view is labelled PRD graph and the analysis view Add items everywhere in the UI; no view other than the Plan stage is labelled Plan."
  - "The restored-views test passes because merged views stay registered."
  - "Every glossary line and the iso map's expand-in-place still render on the merged sections; their tests move with the views rather than being deleted."
description: "#425's Analysis stage (views/stages.ts) shows Repository map (with a 2D/3D toggle to the isometric map), Zones, Architecture and Routes as separate collapsible sections. Consolidate them into one Terrain section with Map, Isometric map and Zones tabs, and one Architecture section with Architecture and Routes tabs. Every view keeps its own route and full page, and a section's Open link opens the active tab's view. Two 0.7.1 additions must survive: the glossary definition lines (Files, Zones and its detail panel, the PRD tree, Workspaces, hench Config) and #410's readable zone hierarchy and iso-map areas that expand in place.\n\nImplementation notes: Generalise StageSection.alt in views/stages.ts into a list of tabs rather than building separate tab-container views, and render the tabs in views/stage-pages.ts, reusing views/iso-map.ts, zones.ts, architecture.ts and routes.ts unchanged as tab bodies. The isometric tab stays hidden in deployed (static) mode, as the 3D toggle is today. Labels come from the navigation model (22d013f6). Web viewer only. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:30:42.967Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
