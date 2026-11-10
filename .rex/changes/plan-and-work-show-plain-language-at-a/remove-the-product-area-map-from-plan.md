---
id: "5e0b017a-67ef-4020-915b-06e8fdc08ab6"
type: "task"
title: "Remove the product area map from Plan"
slug: "remove-the-product-area-map-from-plan"
description: "The Plan page's product area map (views/product-area-map.ts, rendered via views/view-registry.ts) is not sized properly and its purpose is not apparent on first viewing. Remove it from Plan unless a case for keeping it is recorded on the change first."
acceptanceCriteria:
  - "Plan no longer renders the area map tile, unless someone records a case for keeping it on the change first"
  - "The area view (/product/area/<slug>) stays reachable from the Product page, and no link breaks"
  - "Tests that assert the map on Plan are updated or removed"
priority: "medium"
source: "ndx-capture"
---
