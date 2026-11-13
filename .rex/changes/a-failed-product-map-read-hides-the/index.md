---
id: "bfa01a20-f5b9-44dd-bd0d-17d5e6c3c070"
type: "change"
title: "A failed Product map read hides the Requirements tab"
slug: "a-failed-product-map-read-hides-the"
intent: "On a v2 project whose `/api/rex/product` read fails (server error, network), `ProductPage` (packages/web/src/viewer/views/product-pages.ts, the `load.state !== \"ready\"` branch) renders `Pending` alone on the Map tab with no tablist. The requirements view reads its own data and would work, but the only way in is typing `/requirements`. Pre-existing; found by adversarial review of d16dddb6, which added `ProductTabs` for the v1 branch.\n\nFix (recommended, cheap): wrap that branch in `ProductTabs` the same way the v1 branch is — Map shows `Pending` (the error), Requirements shows `RequirementsView`. Risk: none beyond test churn.\n\nVerdict: out-of-scope (pre-existing), low."
acceptanceCriteria:
  - "When the product read fails on the Map tab, the Product page still renders the Map/Requirements tablist with the error in the Map panel"
  - "A product-pages unit test stubs a failing /api/rex/product, clicks Requirements, and asserts the coverage read happens"
touches:
  - "d5ad6f16-156d-496f-99e5-0230dd48cd47"
priority: "low"
discoveredFrom: {"item":"d16dddb6-440d-4acc-9306-d27aabde0b50","run":"d50fdf25-3c68-41d6-9379-8f60159468fa"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
