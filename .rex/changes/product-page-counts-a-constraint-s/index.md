---
id: "e6e43880-707f-4e27-b84b-b574b9522cc1"
type: "change"
title: "Product page counts a constraint's open changes in the total but its Constraints table never shows them"
slug: "product-page-counts-a-constraint-s"
intent: "Found by the adversarial review of 67ab90c9 (Open changes total counts top-level constraints). Verdict: should-fix; severity low.\n\nScenario: on a v2 project, the only open change touches a top-level constraint. productTotals now reads \"Open changes 1\", but the Constraints table (Constraints in packages/web/src/viewer/views/product.ts:138) renders only title, health and applies-to. ConstraintRow.openChanges is never drawn, so the reader cannot find the counted change on the page, though the page's subtitle says \"Open changes show as overlays.\" Capability rows render their overlays; constraint rows do not.\n\nReachable: the Product page on any v2 project with an open change on a constraint. Not covered: no test renders constraint overlays.\n\nOptions:\n(a) Recommended. Add an \"Open changes\" cell to the Constraints table that reuses the capability rows' overlay rendering. Cost: one cell and one render test. Risk: low.\n(b) Leave it. The total still links readers to the Changes list. This is cheaper, but the page keeps claiming that overlays show."
acceptanceCriteria:
  - "The Product page's Constraints table shows each open change a constraint row carries in ConstraintRow.openChanges"
  - "A render test in packages/web/tests/unit/viewer/product-view.test.ts asserts a constraint row shows its open change's title, and fails today"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "low"
discoveredFrom: {"item":"67ab90c9-35d3-44b3-9850-1289d404be46","run":"e569669d-dce4-4648-ba7d-46fa639e7bd2"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
