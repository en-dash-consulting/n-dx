---
id: "d7d02895-a0f3-439a-bd3c-1e7d75c4cd05"
type: "task"
title: "Area blocks count every open change that touches the area"
slug: "area-blocks-count-every-open-change"
description: "Stack review finding on #963 at packages/web/src/viewer/views/product-area-map.ts:79 (review comment 4488637203).\n\n**Should fix: the open-change marker misses changes that add a capability to the area**\n\n`openChanges: distinctOpenChanges(area.capabilities)` counts only overlays on the area's existing capabilities. `overlaysByNode` resolves `a.target`, and the target of an unapplied `added` amendment names nothing yet. So an open change that adds a capability `under` the area, the most common way an area grows, is not counted. A `removed` amendment on the area itself is keyed by the area's id, and no block reads that either. In both cases the block shows no open changes while one is open, which contradicts the PR description and docs/packages/web.md line 17 (\"touching or amending the area\").\n\nFix: have the server compute a per-area open-change count. It should include added amendments whose `under` resolves to the area or to one of its capabilities, plus overlays keyed by the area id. Draw the marker from that count."
acceptanceCriteria:
  - "The server computes a per-area open-change count that includes added amendments whose under resolves to the area or one of its capabilities, plus overlays keyed by the area id"
  - "The product area map's block marker draws from that count"
  - "Tests cover an added-capability amendment under the area and an overlay keyed by the area id"
---
