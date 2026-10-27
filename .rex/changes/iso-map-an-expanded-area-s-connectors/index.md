---
id: "1cde82f3-e83a-43c1-b8df-ecfb17e4e25c"
type: "change"
title: "Iso map: an expanded area's connectors leave from the zones that import, not the area's edge"
slug: "iso-map-an-expanded-area-s-connectors"
intent: "With in-place expansion (e5f4bf9f), connectors to other areas still attached to the expanded area's frame, so the map could not show which zone imports what in another area. The areas-level model now carries `crossAreaEdges`: zone-to-zone imports (and calls) between areas, restricted to zones the scenes draw. When an area is expanded, its area-level connectors are replaced by one per visible zone pair. The other end is a zone when that area is expanded too, otherwise the area block, with counts added up. These connectors have no precomputed ground route, so they are drawn as arcs lifted above the blocks, in their own layer over them. A zone's panel lists \"Imported from other areas\" and \"Imports in other areas\", and selecting an expanded area highlights its zones' connectors."
acceptanceCriteria:
  - "jsdom: expanding one area replaces its area-level connector with zone-to-area arcs"
  - "jsdom: with both areas expanded, connectors run zone to zone and appear in the zone's panel"
  - "Screenshot of n-site2 with Apps expanded shows arcs from individual Apps zones to the other areas"
  - "pnpm --filter @n-dx/sourcevision test passes; iso-skill drift passes"
touches:
  - "6a8f9616-59f0-458f-8e56-45abbb00a3da"
priority: "high"
tags:
  - "sourcevision"
  - "iso-map"
source: "ndx-capture"
---
