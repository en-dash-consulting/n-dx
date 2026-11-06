---
id: "4e3d99af-061e-4615-96af-d416147d7d78"
type: "change"
title: "Product page's Open changes total misses changes that add a capability or amend an area"
slug: "product-page-s-open-changes-total"
intent: "Found by the adversarial review of task d7d02895 (area blocks count every open change). Verdict: out-of-scope, pre-existing.\n\nScenario: an open change carries only {target: \"refunds\", delta: \"added\", under: <area id>}, or only {target: <area id>, delta: \"removed\"}. GET /api/rex/product now reports it in the area's openChangeIds, and Plan's area map counts it, but the Product page's summary row reads \"Open changes 0\": productTotals (packages/web/src/viewer/views/product-model.ts:721) unions only capability.openChanges, which never carries an unapplied addition (its target names nothing) or an overlay keyed by an area id. The two views now disagree on the same data.\n\nReachable: the Product page on any v2 project with an open change that adds a capability, the most common way an area grows.\n\nOptions:\n(a) Recommended. Have productTotals union capability overlays with every area's openChangeIds (the server's per-area set), so it counts each change once. Cheap; one function and its test in product-view.test.ts.\n(b) Send a map-level openChanges count from the server. Cleaner wire but another field; only worth it if a second consumer appears.\n\nNote: an open change that touches only a top-level constraint (not in an area) is still in neither set; decide whether the total should include constraint overlays too."
acceptanceCriteria:
  - "productTotals counts an open change that only adds a capability under an area (present in that area's openChangeIds, in no capability overlay)"
  - "productTotals counts an open change whose only amendment removes an area"
  - "A change listed on an area and on one of its capabilities counts once"
  - "Tests in packages/web/tests/unit/viewer/product-view.test.ts cover each case and fail before the fix"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
discoveredFrom: {"item":"d7d02895-a0f3-439a-bd3c-1e7d75c4cd05","run":"d0b3ff67-a56e-4ad3-912d-ce4c68f2273c"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
