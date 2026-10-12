---
id: "383ce533-4936-4e4b-a06e-65e8a58ece3b"
level: "task"
title: "A change's touches and amends name a capability or constraint"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "v2-rules"
source: "overnight-side-session"
startedAt: "2026-10-10T17:52:36.922Z"
completedAt: "2026-10-10T17:58:03.285Z"
endedAt: "2026-10-10T17:58:03.285Z"
resolutionType: "code-change"
resolutionDetail: "ref-resolves: touches and modified targets must name a capability or constraint; removed and added-under still accept an area. Test and changeset added."
acceptanceCriteria:
  - "checkV2Rules reports an error when a change touches an area, or names an area as the target of a `modified` amendment (test)"
  - "A `removed` amendment may name an area, as apply-amendments and rex reshape use it, and an area as the `under` of an added amendment stays valid (test)"
  - "The v2 fixture tree still passes every rule (test)"
  - "The changeset carries one line fit for the release notes, saying this tightens a v2 rule under the soft freeze"
description: "ref-resolves accepts any product node for a change's touches and for a non-added amends target (packages/rex/src/schema/v2-rules.ts, PRODUCT_NODE), so a change can name an area. Placement already refuses an area (core/change-place.ts recordPlacement). Fix it in the rules, with no schema shape change.\n\nDecision (2026-10-10, D1): a `removed` amendment on an area stays valid. apply-amendments retires an area together with its descendants (tests/unit/core/apply-amendments.test.ts), and rex reshape drafts a `removed` amendment for an OBSOLETE area (tests/integration/layer-aware-restructure.test.ts). Only `touches` and `modified` must name a capability or constraint. The first run (8611f18d) stopped on this conflict."
lastModified: "2026-10-10T17:58:03.559Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
