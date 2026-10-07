---
id: "9eed16cc-2d81-4de8-9fe6-04b5641720cd"
level: "task"
title: "computeProductStatus never marks a node defective for an open fix, because an open change cannot derive kind fix"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A fixture with an open change marked as a fix that touches a capability whose checks all pass yields health \"defective\" for that capability"
  - "The same fixture without the fix marking yields health \"ok\""
  - "How an open change is identified as a fix is documented in core/product-status.ts and in the v2 schema"
description: "Verdict: should-fix (severity medium). Found by adversarial review of task 277ca835.\n\nScenario: an open change touches capability A to repair a bug no automated check catches (A's checks pass or are absent). computeProductStatus(tree) reports A as health \"ok\". The task asked for \"defective when an open fix touches it\".\n\nEvidence: packages/rex/src/core/product-status.ts. Health marks a node defective only when deriveChangeKind(change, index, options) === \"fix\", and deriveChangeKind (core/product-edges.ts) returns fix only for touched ids in options.fixed, meaning \"capabilities that went failing to met\". That is history, available only after the fix lands, so for an open change the open-fix path is effectively dead. Only a failing check marks a node defective today.\n\nReachability: v2 is not wired to the store yet, so there are no callers today. It becomes reachable once the capability views and the dashboard consume computeProductStatus.\n\nOptions:\n(a) Mark the intent on the change: an explicit field (e.g. `fix: true`, like `spike: true`) or a reserved tag. Cheap and deterministic, but it adds a schema field (v2.ts, AmendmentSchema-adjacent). Recommended.\n(b) Treat an open change that touches a node with a failing check as a fix. No schema change, but redundant: that node is already defective via its check.\n(c) Let callers pass a set of open-fix change ids. This only moves the problem to the caller.\nThe choice between (a) and a tag is the schema owner's decision.\n\nDecision (2026-10-07, Ryan): option (a). Add an optional fix: true to changes in schema/v2.ts and its zod schema (beside spike: true). Health is defective when an open change with fix: true touches the node, or one of its checks fails. deriveChangeKind returns fix for a change with fix: true that touches without amending. This is an approved v2 schema change (second exception to the lane's no-schema-edit rule, with 606ebb1c). It lands in one schema task with 606ebb1c and any further schema additions from the pre-freeze review."
lastModified: "2026-10-07T23:36:49.205Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
