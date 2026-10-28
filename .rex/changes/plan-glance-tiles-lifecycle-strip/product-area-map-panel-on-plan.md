---
id: "327fdc16-955c-4428-a05a-4195d92b8c7c"
type: "task"
title: "Product area map panel on Plan"
slug: "product-area-map-panel-on-plan"
description: "A new StagePanelId `product-map` for the Product tile: one block per area, sized by capability count, tinted by computed status (met, changing, proposed, defective), with a count marker for open changes touching or amending it. Small areas may fold into \"+N smaller areas\". A block opens the Product page at that area. Reads the product summary the Product view already fetches."
acceptanceCriteria:
  - "The tile draws one block per area sized by its capability count and tinted by status, with a legend"
  - "An area with open changes shows their count"
  - "Clicking or keyboard-activating a block opens that area on the Product page"
  - "Blocks have accessible names giving the area, its counts and status"
priority: "medium"
source: "ndx-capture"
---
