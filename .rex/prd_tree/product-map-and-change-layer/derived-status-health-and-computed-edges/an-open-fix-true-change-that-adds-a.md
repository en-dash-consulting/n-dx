---
id: "96360a7f-9402-44b1-9c83-0cd3e212bd5a"
level: "task"
title: "An open fix: true change that adds a capability marks the new capability defective while its kind is feature"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A change with fix: true and an added amendment either fails a v2 rule or leaves the added capability's health ok"
  - "A test covers a fix: true change with mixed added and modified amendments, asserting kind and health agree"
description: "Verdict: should-fix (severity low). Found by adversarial review of task 9eed16cc.\n\nScenario: an open change { fix: true, amends: [{ target: new-cap, delta: added }, { target: old-cap, delta: modified }] }. deriveChangeKind (packages/rex/src/core/product-edges.ts:62) returns \"feature\" because an added amendment rules out fix, but computeProductStatus (packages/rex/src/core/product-status.ts:61-66) marks every amends/touches target defective, so the brand-new capability reads health \"defective\" although nothing about it is broken. Health and kind disagree about whether the change is a fix.\n\nReachability: none today (v2 not wired to the store); reachable once capability views and the dashboard consume computeProductStatus.\n\nOptions:\n(a) v2 rule (e.g. fix-not-additive, error) refusing fix: true on a change with an added or removed amendment, so the inconsistent state cannot be authored. Cheap; one rule + test. Recommended.\n(b) Only mark defective the targets that are not added/removed by the fix change. Keeps the data valid but silently drops the flag's meaning on mixed changes.\n(c) Leave as is and document. The current behaviour matches the approved wording (\"targets the node through amends or touches\"), so this is the schema owner's decision.\n\nDecision (2026-10-08, Ryan): option (a). Add an error rule fix-not-additive in schema/v2-rules.ts: a change with fix: true cannot carry an added or removed amendment. Done in the same run as 606ebb1c (sonnet run, opus review)."
lastModified: "2026-10-08T04:26:26.482Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
