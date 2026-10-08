---
id: "2f000cd0-cc4d-4280-ba07-50f7e3d5c6c6"
level: "task"
title: "An open change may modify, touch or add under a retired product node without a v2 rule finding"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "checkV2Rules reports an error for an open change whose modified target resolves only to a retired product node"
  - "checkV2Rules reports an error for an open change whose added amendment's under resolves only to a retired product node"
  - "An applied change referencing the same retired nodes still produces no finding"
  - "Unit tests in tests/unit/schema/v2-rules.test.ts cover each case and fail before the fix"
description: "Found by the adversarial review of task 494ec070. Verdict: out-of-scope. The behaviour pre-exists in task ba39230d's decision that ref-resolves resolves against tombstones, and 494ec070 kept that handling as instructed.\n\nScenario: a deleted capability \"gone\", and an open (unapplied) change carrying {target gone, delta modified} and {target n, delta added, under gone}. checkV2Rules returns no error (verified against dist). Neither plan can be realized: you cannot edit a retired node or place a new node under one. removed-target-live covers only the removed delta.\n\nA reference to a tombstone is fair history for an applied change, but not for an open one. Reachable once the apply engine and placement read v2 trees.\n\nOptions:\n(a) Recommended. Widen removed-target-live, or add a sibling rule, so it covers every product-layer reference an open change makes: touches, modified and removed targets, and an added amendment's under. Each should error when the reference resolves only to a tombstone. This costs a small rule change plus tests, with low risk. Decide whether touches on a retired node should be an error or a warning.\n(b) Leave it to the apply engine to refuse. That is cheaper now, but the validator would keep certifying an unrealizable plan.\n\nDecision (2026-10-07, Ryan): option (a), in PR 30 before the freeze (adding an error after 1.0.0 would break files that pass today). One rule (widen removed-target-live or add a sibling) covers every product-layer reference an open (unapplied, not cancelled or deleted) change makes: touches, modified and removed targets, and an added amendment's under. Each is an error when the reference resolves only to a retired node, including touches. An applied change may still reference a retired node (history). The same run also does d6051f7d (option a: a duplicate added target in one change is an error; keep the first-wins map). Tests for each reference field and for the duplicate case. Stay in schema/v2-rules.ts and its tests; patch changeset for @n-dx/rex."
lastModified: "2026-10-08T01:05:49.058Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
