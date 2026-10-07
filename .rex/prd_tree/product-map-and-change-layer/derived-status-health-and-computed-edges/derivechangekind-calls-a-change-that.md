---
id: "606ebb1c-ce77-4921-9b0e-b155ea84754e"
level: "task"
title: "deriveChangeKind calls a change that adds a new constraint a feature, not a policy change"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A change whose `added` amendment creates a constraint derives kind `policy-change` (unit test in tests/unit/core/product-edges.test.ts)"
  - "An `added` amendment that creates a capability still derives `feature`"
description: "Scenario: a change carries `amends: [{ delta: added, target: <new id>, under: <area>, title: \"No network in tests\" }]` that creates a constraint. The target doesn't exist yet, so `index.resolve(target)` is undefined. deriveChangeKind (packages/rex/src/core/product-edges.ts, the policy-change check) only recognises a constraint by resolving the target's type, so the change falls through to `feature`. The design table says amending a constraint is a policy change.\n\nReachable once the v2 store and the apply engine wire deriveChangeKind in. Nothing calls it yet. Verdict: should-fix (low). The kind is a display and report label, not state.\n\nOptions: (1) Add an optional `type` field to an `added` Amendment in schema/v2.ts naming the node type to create, and read it in deriveChangeKind. This is cheap and explicit, but it changes the schema, which is the user's call. (2) Infer from the `under` parent: unreliable, because constraints may sit at the root. Recommend (1).\n\nDecision (2026-10-07, Ryan): option (1). Add an optional type to an added Amendment in schema/v2.ts and its zod schema naming the node type it creates; deriveChangeKind reads it, so a change adding a new constraint is a policy change. Approved v2 schema change; lands in the same schema task as 9eed16cc."
lastModified: "2026-10-07T23:36:50.261Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
