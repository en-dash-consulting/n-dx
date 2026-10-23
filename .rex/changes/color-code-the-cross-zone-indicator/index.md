---
id: "d593c618-3430-4a92-af3a-7b9b126e314d"
type: "change"
title: "Color-code the cross-zone indicator bar by target zone"
slug: "color-code-the-cross-zone-indicator"
intent: "Replace the single-color cg-file-xzone-bar in the FileRow component (packages/web/src/viewer/views/zones.ts) with a bar colored/segmented by the target zone(s) the file connects to, using each zone's color from the zone list. Multi-target files show proportional stacked segments. Acceptance criteria: (1) A file connecting to one zone shows a bar in that zone's color. (2) A file connecting to multiple zones shows proportional segments per target zone color. (3) Bar colors match the corresponding zone box colors."
touches:
  - "7da57492-972c-4244-bf1e-fe72f37a16e0"
priority: "low"
---
