---
id: "2a940e6b-1f27-4240-8f1e-e988a84ce241"
level: "task"
title: "computeProductStatus reports a retired node defective from its last failing check"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T04:38:45.561Z"
completedAt: "2026-10-08T04:38:45.561Z"
endedAt: "2026-10-08T04:38:45.561Z"
resolutionType: "code-change"
resolutionDetail: "Folded into bd27f348: a retired node reads health ok regardless of stale checks or an open fix change; module doc states it."
acceptanceCriteria:
  - "A deleted capability retired by an applied removal whose last check failed reads health ok (or the documented alternative), with a unit test that fails today"
  - "The product-status module doc states what health means for a retired node"
description: "Found by the adversarial review of 578265ae (Keep retired nodes visible to status, kind and edges). Verdict: should-fix, severity low.\n\nScenario: a capability whose last check result is `fail` is removed by an applied change. Apply sets the capability `deleted`, and computeProductStatus now reports it `{ status: \"retired\", health: \"defective\" }`. The checks are stale: a retired node has no requirement left to fail. The same applies to an open `fix: true` change that still targets the retired node.\n\nEvidence: packages/rex/src/core/product-status.ts, the output loop computes health from `checkFails || fixing.has(node.id)` on retired rows too.\n\nReachability: nothing outside the tests calls computeProductStatus yet. The dashboard and the brief will show this once they read it.\n\nOptions:\n(a) Retired nodes always read health `ok`. One branch plus a test. Cheap, but it hides a fix still open against a retired node.\n(b) Leave health undefined for retired nodes. This changes the ProductStatus type and every consumer.\n(c) Keep the current behaviour and document it.\n\nRecommendation: (a). Decision for the owner: whether health has any meaning for a retired node.\n\nFolded into bd27f348 (same run): a retired node reads health ok; its stale checks and any fix change that still targets it do not make it defective."
lastModified: "2026-10-08T04:38:45.805Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
