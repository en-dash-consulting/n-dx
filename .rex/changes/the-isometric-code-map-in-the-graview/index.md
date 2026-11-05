---
id: "04638e87-5f85-4bef-a4bd-148f5d33946a"
type: "change"
title: "The isometric code map in the Graview face: a Code map page, and each zone page shows its place on it"
slug: "the-isometric-code-map-in-the-graview"
intent: "Asked for on 2026-10-12: surface sourcevision's isometric architecture map in the Graview face. ndx graview emit writes the map (sourcevision's renderIsoMap in embed mode over loadFromSourcevision) beside the snapshot as iso-map.html; the face's door serves it; the face gets a Code map page under Code, and every zone page embeds the map focused on that zone. The map's URL hash names only an area's scene, so sourcevision's embed contract gains a focus message that opens the scene holding a zone and selects it. Carried over from the v1 item 7e2137c9 when the stack was restacked onto the v2 PRD."
acceptanceCriteria:
  - "ndx graview emit . writes iso-map.html under the graview dir when sourcevision analysis exists, and writes none (removing a stale one) when it does not"
  - "The face has a Code map page in the rail's Code group that shows the map full height, in the face's colour scheme"
  - "A zone page shows the map with that zone selected, through the embed contract's { type: \"ndx-iso\", focus: <zone id> } message, including a sub-zone that lives inside an area's scene"
  - "A project with no map shows the face's empty state, never the face inside its own frame"
  - "The generated /iso-map skill script is rebuilt from the sourcevision source, and the iso-skill drift test passes"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
source: "pr-stack:#709 (v1 item 7e2137c9)"
---
