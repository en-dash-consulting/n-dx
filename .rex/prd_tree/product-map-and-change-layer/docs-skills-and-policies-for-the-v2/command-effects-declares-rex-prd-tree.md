---
id: "a5a70901-38b5-47d0-99ab-07599c18f4c9"
level: "task"
title: "command-effects declares {rex}/prd_tree/ as the PRD read/write for every command on a v2 project"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 project the effects that resolveCommandEffects/localizeEffects return for ndx add name {rex}/changes/, not {rex}/prd_tree/"
  - "A unit test in tests/unit/command-effects.test.js pins the v2 expansion"
description: "Verdict: out-of-scope, pre-existing (low). packages/core/command-effects.js:92-93 define PRD_TREE and PRD_READ as \"{rex}/prd_tree/\" and use them across many commands (add, work, plan, status, …). Scenario: on a v2 project (the default since ndx init scaffolds v2) the preflight banner and the effects shown in help name prd_tree/, which does not exist. The real writes go to {rex}/changes/ and {rex}/product/. Only install-sample and destroy-sample were corrected, in task 349cf1aa. Options: (a) make the layout token expand per project, adding a {prd} token that resolves to prd_tree/ or changes/+product/ in expandLayoutTokens. This is recommended. (b) Name both layouts statically in each entry; this is cheaper but noisy."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T00:30:19.594Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
