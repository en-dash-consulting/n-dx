---
id: "25a733b4-d4eb-4fb6-b5a7-0fc3232c58da"
level: "task"
title: "A product reshape move drafts an added copy that loses the capability's requirements, dependsOn, tags and body"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-18"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T08:43:59.918Z"
completedAt: "2026-10-09T08:52:56.137Z"
endedAt: "2026-10-09T08:52:56.137Z"
resolutionType: "code-change"
resolutionDetail: "Option 1: product-reshape cannotCopy skips reparent/split of a node with tags, body, capability requirements or dependsOn, or one another live node names in dependsOn/appliesTo (id, displayId or alias); reason reported as \"Not drafted\". Unit + integration tests; doc and changeset updated."
acceptanceCriteria:
  - "Reshape of a capability with requirements never drafts a removed+added pair that drops them (test)"
  - "Applying a drafted product move keeps the moved capability's requirements and dependsOn, or the move is not drafted (test)"
description: "Verdict: should-fix (found reviewing 91461587).\n\nScenario: on a v2 tree, a capability with `requirements` (and so checks), `dependsOn`, tags or a body is moved by `rex reshape --accept` (reparent) or split. draftProductReshape's `added()` (packages/rex/src/core/product-reshape.ts) copies only title, statement and capability criteria, because apply's added capability (core/apply-amendments.ts capabilityFields) takes nothing else. The drafted change reads as a move; applying it retires the original and creates a copy without its requirements, so its checks no longer count and dependents' dependsOn point at a retired node.\n\nReachable: `rex reshape --accept` then `rex change apply` on a v2 tree.\n\nOptions: (1) skip reparent/split of a capability that has requirements, dependsOn or a body, with the reason (cheap, safe, loses the feature for those nodes). (2) let an added amendment carry requirements and dependsOn through apply, and copy them in the draft (needs an apply-engine and schema decision). Recommend (1) now, (2) as a design item.\n\nChosen (overnight 2026-10-09, reversible): option 1 only. Skip reparent/split of a capability that has requirements, dependsOn or a body, and report the reason in the reshape output. Option 2 (carrying requirements and dependsOn through an added amendment) changes the apply engine and schema and is left for Ryan; do not do it here."
lastModified: "2026-10-09T08:52:56.403Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
