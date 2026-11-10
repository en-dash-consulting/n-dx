---
id: "9d267a29-0503-44ab-8633-805b207efcd6"
type: "change"
title: "Area view's Moving now omits open changes that add a capability under the area"
slug: "area-view-s-moving-now-omits-open"
intent: "Pre-existing; found by the adversarial review of bc311c6d (Open changes filters by area), out of scope there.\n\nScenario: an area's only open change adds a capability under it (an `added` amendment with `under: <area>`). The map badge says \"1 open\" (openChangesByArea follows `under`), but the area view's Moving now card says \"Nothing is moving here. No open change touches or amends this area.\" and its count reads 0. Because the card hides its \"Open in Open changes\" button when it lists nothing, the area view also offers no way into the filtered list that the badge counts.\n\nEvidence: packages/web/src/server/routes-rex/product.ts buildAreaDetail, `relatesHere` checks only `amends[].target` and `touches`, never an `added` amendment's `under`, whereas openChangesByArea (same file) counts it.\n\nReachable: GET /api/rex/product/area/<slug> → AreaView → AreaCards/MovingNow, on any area with a pending add-capability change.\n\nOptions: (a) recommended — build Moving now from the area's openChangeIds (the same rule as the badge and the ?area= filter), keeping each row's stage and delta; cheap, makes all three agree. (b) extend relatesHere to follow an added amendment's `under`; smaller diff, but leaves two rules to drift again.\n\nVerdict: out-of-scope, severity medium."
acceptanceCriteria:
  - "GET /api/rex/product/area/<slug> lists, in openChanges, a change whose only amendment adds a capability under that area"
  - "The area's counts.openChanges equals its openChangeIds length on the product map, with a server test covering add-under, remove-area and touch cases"
  - "The Moving now card shows its Open in Open changes button for an area whose only open change adds a capability under it"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
discoveredFrom: {"item":"bc311c6d-feb0-4707-824d-ab998cb6d6ff","run":"fcb7f64d-6d1f-4e12-a488-6a63e476ebb5"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
