---
id: "fde93c35-52b1-4b2d-8186-5037e447cff7"
level: "task"
title: "After rex migrate --apply, an item blockedBy a dissolved release or review epic is blocked forever"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-23"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "After apply, no node's blockedBy names a dissolved container id (test with a v1 task blockedBy a release epic)"
  - "A change whose v1 blocker was a release epic with all children completed is selectable by change-selection after apply (test)"
description: "Found by the adversarial review of 11c88bce (run 48148488). Verdict: should-fix.\n\nFailure: a v1 item has blockedBy naming an epic the plan dissolved. That is target \"release\": a release umbrella, or an epic filed by an adversarial review. Apply (migrations/v1-to-v2/apply.ts, toNode) copies blockedBy unchanged, but the epic becomes no node; it is only listed in the cut change's body. In core/change-selection.ts:65, `index.resolve(ref)?.status !== \"completed\"` reads an unresolved ref as an open blocker, so the item is never selected again. rex health also reports ref-resolves on it.\n\nReachability: any v1 tree with a dependency on a release or review epic. The plan (migration-plan-data) does not rewrite blockedBy either.\n\nOptions:\n(a) At apply, replace a ref to a dissolved container with the container's children (the changes it split into). This keeps the dependency's meaning, but can fan out to many refs.\n(b) Drop the ref when every child of the container is completed, otherwise replace it as in (a).\n(c) Drop the ref and note it in the item body. This is simplest, but loses the ordering.\nRecommendation: (a), recorded in the plan's data so a reviewer sees it."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T08:34:28.473Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
