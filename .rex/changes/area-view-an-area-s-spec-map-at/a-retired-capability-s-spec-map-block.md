---
id: "0a8a9c7c-6e0a-4717-a428-0dbd836584a6"
type: "task"
title: "A retired capability's spec-map block is tinted and named as proposed"
slug: "a-retired-capability-s-spec-map-block"
description: "Found by an adversarial review of 18fc7905. packages/web/src/viewer/views/area-spec-map.ts capabilityBlock() sets `status: blockStatus([row])`. blockStatus (product-area-map.ts:45) drops retired rows and returns \"proposed\" when none are left. The area detail route (server routes-rex/product.ts:648) sends every capability in the section, retired ones included. Scenario: an area holds a capability whose status is \"retired\". The area view draws that capability as a \"Proposed\" block, tinted as unbuilt, with the accessible name \"<title>: N criteria, proposed, ...\". A user then reads a retired spec as work still to build. Reachable from /product/area/<slug> and from the area view opened in place on Plan. Verdict: should-fix, medium. It is a wrong status on a real path, but no data is lost. Options: (a) leave retired capabilities off the spec map: filter them in SpecMap, or sort them last and draw them muted. Cheap, but the count no longer matches the area header. (b) Add a \"retired\" BlockStatus with its own muted tint and legend entry. Clearer, but it touches the shared block legend. Recommended: (a) filter, unless the area view should list retired specs. That decision belongs to the steward."
acceptanceCriteria:
  - "A capability with status \"retired\" is never drawn as a block whose data-status is \"proposed\""
  - "A unit test in area-spec-map.test.ts mounts SpecMap with a retired capability and asserts how it is drawn (left out, or drawn with a retired status)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
