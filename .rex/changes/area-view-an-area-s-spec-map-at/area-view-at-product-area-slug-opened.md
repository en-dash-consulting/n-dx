---
id: "056a30fd-25f2-428d-a193-308a7c6fcc8b"
type: "task"
title: "Area view at /product/area/<slug>, opened in place from Plan"
slug: "area-view-at-product-area-slug-opened"
description: "A new view (views/area.ts) with its own route, /product/area/<slug>. Opened from a Plan map block it fills the Product map tile's full-screen; Esc and the breadcrumb (Plan › Product map › <area>) return to Plan at the same scroll. Loaded directly, it renders on the Product page with that area in focus. Header: summary, counts, steward chip, \"+ Change in this area\" and \"Open on Product page\". Replaces S3's interim behaviour of opening the Product page."
acceptanceCriteria:
  - "Clicking a Plan map block opens the area view in the tile's full-screen and updates the URL to /product/area/<slug>"
  - "Esc and the breadcrumb return to Plan at the same scroll position"
  - "Loading the URL directly shows the area view on the Product page"
  - "The header shows the area's summary, counts and steward chip ('no steward' when none)"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "50c98ea3-d30c-4eea-8df7-fece3958d327"
---
