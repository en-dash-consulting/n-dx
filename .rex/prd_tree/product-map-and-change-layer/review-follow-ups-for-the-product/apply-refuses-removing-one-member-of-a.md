---
id: "648d1971-3e33-41e6-a94a-12c9cc984ff9"
level: "task"
title: "Apply refuses removing one member of a pre-existing dependsOn knot that stays cyclic"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A unit test in apply-amendments.test.ts builds a→{b,c}, b→c, c→a under one area, applies a change removing b, and expects the apply to succeed with b retired"
  - "A pre-existing knot split by a removal into separate cyclic components still applies"
  - "A depends-on-acyclic finding whose members were not all in one cyclic component before apply is still refused"
description: "Verdict: should-fix (low). Found while reviewing d7cf6126 (commit 86c605e11). The defect predates that commit: the old per-cycle DFS refused the same input.\n\nScenario (reproduced): an area holds a (dependsOn b, c), b (dependsOn c) and c (dependsOn a). A change removes b. Before apply, depends-on-acyclic reports 'dependsOn cycle among \"A\", \"B\", \"C\"' on a. After apply, b is retired and hidden from the rules, so the component shrinks to {a, c}, and the message becomes 'dependsOn cycle among \"A\", \"C\"'. newErrors (packages/rex/src/core/apply-amendments.ts, keyed on rule + nodeId + message) treats it as new, and the result is \"Cannot apply change: the result breaks depends-on-acyclic: dependsOn cycle among \"A\", \"C\"\". force does not bypass it. Retiring a member only shrinks the knot and can never create a cycle.\n\nReachability: a removed amendment targeting a capability inside a pre-existing knot that stays cyclic without it. The tree is already in an error state, so the effect is a false refusal, not data loss.\n\nOptions:\n1. (Recommended) In newErrors, treat a depends-on-acyclic finding in the result as pre-existing when every member of its component was in a single cyclic component before apply. Apply cannot add dependsOn edges and retiring nodes only splits or shrinks components, so this is exact. Cost: a small member-set comparison, which needs the members exposed (for example a structured field on the finding, or a helper exported from v2-rules that returns the components).\n2. Key depends-on-acyclic's identity on the before-apply component that contains it. This is the same as option 1 but placed in the rule layer. More plumbing."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
