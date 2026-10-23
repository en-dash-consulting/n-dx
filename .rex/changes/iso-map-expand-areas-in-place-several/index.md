---
id: "e5f4bf9f-3a37-4c5c-a4f5-b6a9f7127c44"
type: "change"
title: "Iso map: expand areas in place, several at once, instead of only opening one area on its own"
slug: "iso-map-expand-areas-in-place-several"
intent: "After areas landed (7cd180ef), opening an area replaced the map with a view of that area alone. Expanding should happen in place: the area's block becomes a flat frame carrying its zones, and the rest of the map stays around it.\n\nBuilt in the renderer runtime (`export/iso-map.ts`), with no model changes:\n- `compose()` builds the drawn scene from the areas model and the set of expanded areas. An expanded area's footprint grows to its precomputed scene's bounds plus padding. Grid columns and rows widen by the difference, so every other block keeps its place relative to the grid.\n- Connector points are remapped per axis (proportional inside a column or row, offset in the gaps), and endpoints snap to their block's face so the adjacent segment stays orthogonal. The expanded area's own zone-to-zone connectors come from its scene.\n- In the composed scene, area nodes are `area:<id>`, so an area and a zone can share an id.\n- Double-click, or **Expand here** / **Collapse** in the panel, toggles expansion. Several areas can be open at once. **Open on its own** is kept. A selected expanded area keeps its zones lit."
acceptanceCriteria:
  - "jsdom: double-clicking an area draws its zones on a frame while the other areas stay; double-clicking again collapses it"
  - "jsdom: two areas expanded at once, including an area whose id equals a zone id in another area"
  - "jsdom: inter-area connectors remain after expansion and the area's internal connectors are added"
  - "Screenshots of n-site2 with Apps, and Apps + Components, expanded"
  - "iso-skill drift test passes; pnpm --filter @n-dx/sourcevision test passes"
touches:
  - "6a8f9616-59f0-458f-8e56-45abbb00a3da"
priority: "high"
tags:
  - "sourcevision"
  - "iso-map"
source: "ndx-capture"
---
