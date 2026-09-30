---
id: "6a62ff2c-5713-421e-b250-296b8ceb5a35"
level: "feature"
title: "Navigation and landings"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "navigation-landings"
source: "caos work management: feature ndx 0.8.0 - Navigation and landings"
acceptanceCriteria:
  - "ndx start on a never-analysed project shows Home with the next command, never an empty tool view."
  - "The sidebar renders 7 groups and 24 items with no expand-one-at-a-time behaviour; the collapsed rail shows Home, Flight Deck and the three package icons."
  - "/overview, /rex-dashboard, /graph, /iso-map, /zones, /architecture and /routes redirect; the navigation contract test passes with zero console errors for every view."
  - "The restored-views test passes because merged views stay registered as tabs."
  - "Every glossary line and the iso map's expand-in-place still render on the merged pages; their tests move with the views rather than being deleted."
description: "Replace the hardcoded 33-item accordion sidebar with a data model shared with landing cards, every section always open, a collapsed rail, and a redirect alias for every moved path. Add Home as the default view in four states (not initialised, initialised but not analysed, analysed without a PRD, PRD present), each saying what to do next. Turn SourceVision Overview and Rex Dashboard into package landing pages and add a Hench landing; move Rex's execution panels out to the Flight Deck. Merge Map, Isometric Map and Zones into a tabbed Terrain page and Architecture and Routes into a tabbed Architecture page. Rename Analyze & Import to Plan and Context Graph to Graph. The old view ids stay registered as tabs so nothing is orphaned.\n\nTwo 0.7.1 additions move with their views and must survive the merge: the glossary definition lines (Files, Zones and its detail panel, the PRD tree, Workspaces, hench Config), and #410's readable zone hierarchy and iso-map areas that expand in place, which the Terrain page keeps.\n\nGoal: A user always lands somewhere that tells them the project's state and next step, and finds every view within 24 sidebar items."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a next-step panel with four project states to the Home landing](./add-a-next-step-panel-with-four.md) | pending |
| [Add redirect aliases for every moved dashboard path and a navigation contract test](./add-redirect-aliases-for-every-moved.md) | in_progress |
| [Make stages.ts the single navigation model: one label, glyph, product and blurb per view, read by every navigation surface](./make-stages-ts-the-single-navigation.md) | completed |
| [Merge the Analysis stage's map, isometric map and zones into one tabbed Terrain section, and Architecture and Routes into one tabbed section](./merge-the-analysis-stage-s-map.md) | pending |
| [Turn SourceVision Overview and Rex Dashboard into package landing pages, add a Hench landing, and move Rex execution panels to the Flight Deck](./turn-sourcevision-overview-and-rex.md) | cancelled |
