---
id: "2e50d91e-5baf-4acc-8f2c-f4db37019b89"
level: "task"
title: "Apply refuses a change over a pre-existing dependsOn cycle whose report rotates after a removal"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T04:46:36.368Z"
completedAt: "2026-10-08T04:52:44.687Z"
endedAt: "2026-10-08T04:52:44.687Z"
resolutionType: "code-change"
resolutionDetail: "dependsOnAcyclic reports each cycle on its smallest-id member with the path rotated there (995499d4b)"
acceptanceCriteria:
  - "A unit test in apply-amendments.test.ts builds A (dependsOn B), C (dependsOn B), B (dependsOn C) under one area, applies a change removing A, and expects the apply to succeed with A retired."
  - "A dependsOn cycle the change itself introduces or changes is still refused."
  - "Error findings already in the input tree, under any rule, never cause an apply refusal because their message or reporting node shifts."
description: "Verdict: should-fix (low). Introduced by 8cfdb939 (c47baa4a1).\n\n`newErrors` in packages/rex/src/core/apply-amendments.ts compares error findings before and after apply by rule + nodeId + message. `depends-on-acyclic` (schema/v2-rules.ts dependsOnAcyclic) reports a cycle on the node where its DFS first re-enters, with a path whose rotation depends on which capability the DFS starts from. Removing a capability that is not in the cycle can change the start node, so the same cycle comes back with a different nodeId and message and reads as a new error.\n\nScenario: an area holds capabilities A (dependsOn B), C (dependsOn B) and B (dependsOn C), in that order. Before apply, the DFS starts at A, giving finding on B, \"B → C → B\". A change removes A. After apply, the DFS starts at C, giving finding on C, \"C → B → C\". applyAmendments then throws \"the result breaks depends-on-acyclic\" for a change that touched nothing in the cycle, and `force` does not bypass the rules check.\n\nReachability: any apply of a removed amendment on a tree that already carries a dependsOn cycle error. The tree is already in an error state, so the impact is a false, confusing refusal, not data loss.\n\nOptions:\n1. (Recommended) Compare depends-on-acyclic findings by the sorted set of cycle members, not by message. This needs either a cycle-key field on RuleFinding or a local key in newErrors that maps such a finding to its cycle. Small cost; it touches the RuleFinding shape if done in the rules.\n2. Compare all findings by rule + nodeId only. Cheap, but it still misses a nodeId rotation and loosens every other rule.\n3. Make dependsOnAcyclic report each cycle on a canonical node (for example the smallest id) with a canonical rotation. Fixes the instability at the source for every reader of the rules. It changes v2-rules output, which is after the freeze.\n\nDecision (2026-10-08, Ryan): option (3). Make depends-on-acyclic in schema/v2-rules.ts report each cycle canonically: on the cycle member with the smallest id, with the path rotated to start there, so the same cycle always yields the same nodeId and message for every reader (apply's before/after comparison, rex health). Done in the same run as 2d87cf58 (sonnet run, opus review). Test: the reviewer's scenario (A, C, B with A removed) applies cleanly."
lastModified: "2026-10-08T04:52:44.914Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
