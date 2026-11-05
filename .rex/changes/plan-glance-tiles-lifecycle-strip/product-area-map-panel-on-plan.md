---
id: "327fdc16-955c-4428-a05a-4195d92b8c7c"
type: "task"
title: "Product area map panel on Plan"
slug: "product-area-map-panel-on-plan"
description: "A new StagePanelId `product-map` for the Product tile, full width (12 columns) directly under the lifecycle strip: one block per area, sized by capability count, tinted by computed status (met, changing, proposed, defective), with a count marker for open changes touching or amending it. Small areas may fold into \"+N smaller areas\". A block opens /product/area/<slug> with the area's frozen v2 slug; until S6 builds the area view, that route opens the Product page at the area. Reads the product summary the Product view already fetches. Keep the block component reusable: S6 draws an area's capabilities with it."
acceptanceCriteria:
  - "The tile draws one block per area sized by its capability count and tinted by status, with a legend"
  - "An area with open changes shows their count"
  - "Clicking or keyboard-activating a block navigates to /product/area/<slug>"
  - "Blocks have accessible names giving the area, its counts and status"
  - "The block component is exported for reuse by the area view"
priority: "medium"
source: "ndx-capture"
---
