---
id: "67ab90c9-35d3-44b3-9850-1289d404be46"
type: "change"
title: "Product page's Open changes total omits a change that touches or amends only a top-level constraint"
slug: "product-page-s-open-changes-total-67ab90"
intent: "Found by the adversarial review of 4e3d99af (Product Open changes total). Verdict: out-of-scope, pre-existing; severity low.\n\nScenario: on a v2 project, the only open change carries touches: [<constraint id>] or amends {target: <constraint id>, delta: modified}, and the constraint sits at the top level of product/, not under an area. GET /api/rex/product puts it in no area's openChangeIds (openChangesByArea, packages/web/src/server/routes-rex/product.ts:362, skips nodes with no area ancestor) and in no capability overlay. productTotals (packages/web/src/viewer/views/product-model.ts:812) therefore reads \"Open changes 0\" while a change is open against the map. Plan's area map omits it too, so the two views still agree. It is a product decision, not a disagreement between views.\n\nOptions:\n(a) Recommended. Send constraint overlays on ConstraintRowWire (the server already builds overlaysByNode for every node), and have productTotals union them. Plan's area map stays per-area. Cost: one wire field, one union, one test.\n(b) Decide the total means \"open changes on areas\" and relabel the metric. No code beyond the label and docs.\n\nDecision (2026-11-06, run e569669d): option (a). The Product page's Open changes total includes a change that only touches or amends a top-level constraint. ConstraintRowWire carries openChanges (from overlaysByNode) and productTotals unions them. Plan's area map stays per-area, so in this case the Product total can exceed the distinct changes across the area badges."
acceptanceCriteria:
  - "Decide whether the Product page's Open changes total includes changes that only touch or amend a top-level constraint, and record the decision in the change"
  - "If included: productTotals counts an open change whose only reference is a top-level constraint, covered by a test in packages/web/tests/unit/viewer/product-view.test.ts that fails today"
  - "If excluded: the metric's label or tooltip says it counts changes on areas, and a test asserts that wording"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "low"
discoveredFrom: {"item":"4e3d99af-061e-4615-96af-d416147d7d78","run":"078fab93-e897-4832-9a02-1be1ef91a98c"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
