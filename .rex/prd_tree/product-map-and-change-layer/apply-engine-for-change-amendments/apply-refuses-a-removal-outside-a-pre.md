---
id: "d7cf6126-982b-4d9a-bfa8-b4189a7f0f55"
level: "task"
title: "Apply refuses a removal outside a pre-existing dependsOn knot because the DFS reports a different sub-cycle"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T05:07:55.987Z"
completedAt: "2026-10-08T05:15:59.530Z"
endedAt: "2026-10-08T05:15:59.530Z"
resolutionType: "code-change"
resolutionDetail: "dependsOnAcyclic now uses Tarjan SCCs: one finding per cyclic component on its smallest id, members sorted. Commit 86c605e11."
acceptanceCriteria:
  - "A unit test in apply-amendments.test.ts builds d→a, c→a, a→{b,c}, b→c under one area, applies a change removing d, and expects the apply to succeed with d retired"
  - "A v2-rules test shows depends-on-acyclic returns identical findings for the same dependsOn knot whichever capability the walk enters it from"
  - "A dependsOn cycle the change itself introduces is still refused"
description: "Verdict: should-fix (low). Follow-up to 2e50d91e (995499d4b), which made depends-on-acyclic report each cycle canonically. That fixes a rotated report of the same cycle, but not a different set of cycles.\n\ndependsOnAcyclic (packages/rex/src/schema/v2-rules.ts) reports one finding per DFS back edge. When a strongly connected component holds several elementary cycles, which of them are reported depends on where the DFS enters the component. newErrors (core/apply-amendments.ts:211) compares by rule + nodeId + message, so a cycle that was not reported before apply looks new.\n\nReproduced: an area holds d (dependsOn a), c (dependsOn a), a (dependsOn b, c) and b (dependsOn c), in that order. Before apply, the walk enters at a, giving {a,b,c} only. A change removes d. After apply, the walk starts at c, giving {a,b,c} and {a,c}. The result is \"Cannot apply change: the result breaks depends-on-acyclic: dependsOn cycle: \"A\" → \"C\" → \"A\"\". The change touched nothing in the knot, and force does not bypass this check.\n\nReachability: any removed amendment on a tree that already carries a dependsOn knot with more than one elementary cycle. The tree is already in an error state, so the impact is a false refusal, not data loss.\n\nOptions:\n1. (Recommended) Report one finding per strongly connected component (Tarjan), on its smallest-id member, with the members listed in a canonical order. Stable for every reader. It changes the rule's output again (one finding per knot, not per cycle). Small cost.\n2. Keep per-cycle reports, but in newErrors treat a depends-on-acyclic finding as pre-existing when all of its members were in one cycle-bearing component before apply. This is local to apply, so rex health stays unstable.\n\nDecision (2026-10-08, Ryan): option 1. depends-on-acyclic reports one finding per strongly connected component that contains a cycle (Tarjan), on its smallest-id member, listing the members in a canonical (sorted) order, so the output is stable for apply's before/after comparison and for rex health. Update the existing cycle tests and add the reviewer's knot scenario (a removal outside the knot applies cleanly)."
lastModified: "2026-10-08T05:16:00.242Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
