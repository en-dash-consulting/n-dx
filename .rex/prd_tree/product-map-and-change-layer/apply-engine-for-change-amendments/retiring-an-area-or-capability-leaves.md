---
id: "a16699dd-edc5-4191-b94e-8c21110f7381"
level: "task"
title: "Retiring an area or capability leaves its live descendants hidden from every v2 rule"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "product-map"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "applyAmendments on a removed amendment whose target has a live descendant either refuses (naming the descendant) or retires the descendants too, as decided"
  - "A unit test in tests/unit/core/apply-amendments.test.ts removes an area with a live capability and asserts the chosen behaviour"
description: "Verdict: should-fix (adversarial review of 17a8312b). Scenario: a change with a removed amendment that targets area A1, while capability A1.1 under it is still live. applyAmendments (packages/rex/src/core/apply-amendments.ts, applyRemoved) sets A1 to deleted and does nothing to A1.1. indexTree in schema/v2-rules.ts returns early at a deleted node without visiting its children, so A1.1 drops out of every rule (statement, criteria, long-revised, area-balance) while still reading as live wherever the tree is walked directly. Reachability: the engine is not wired to a command yet; it becomes reachable when the apply command or applyOn lands. Options: (1) refuse removed on a node that has live descendants unless the same change also removes them. This is cheap, explicit and keeps retirement intentional. Recommended. (2) Cascade retirement to descendants with a History line on each. This is convenient but retires nodes nobody named. (3) Leave it and have the rules index visit deleted nodes' children. This changes rule semantics for tombstones.\n\nDecision (2026-10-07, Ryan): option (1). Refuse a removed amendment on a node that has live descendants unless the same change also removes them."
lastModified: "2026-10-07T23:24:19.824Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
