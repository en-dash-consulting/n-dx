---
id: "7e46ba62-91df-43f3-86e5-7c647bd8062b"
level: "task"
title: "capability-criteria warning says bare \"criteria\": \"Capability X has no criteria\""
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T08:38:53.320Z"
completedAt: "2026-10-09T08:43:44.900Z"
endedAt: "2026-10-09T08:43:44.900Z"
resolutionType: "code-change"
resolutionDetail: "Run 7d4d09f4 (claude-sonnet-5-5, review claude-opus-5-5), commit(s) f0ca39542; stale dist only; gate re-run green after rebuild (node scripts/run-all-tests.mjs affected 5915743a6, 5/5 suites passed). Closed by the overnight Lane A session."
acceptanceCriteria:
  - "The capability-criteria finding message reads \"has no capability criteria\" (assertion in v2-rules.test.ts)"
description: "Verdict: out-of-scope (pre-existing). Found by the adversarial review of e9494e36, which fixed the same wording in the criteria-growth message only.\n\nScenario: running `rex health` on a v2 tree that has a capability with no criteria prints `Capability \"X\" has no criteria`. The PR 18 design boundary says help text and errors must never use a bare \"criteria\". This message has the same defect e9494e36 fixed in criteria-growth.\n\nEvidence: packages/rex/src/schema/v2-rules.ts:646 (the capabilityCriteria rule).\n\nReachability: rex health on a v2 tree, which runs the v2 rules.\n\nFix: change the text to `has no capability criteria` and add or update the assertion in packages/rex/tests/unit/schema/v2-rules.test.ts. Cost is trivial; this is user-visible text, not a schema change. Recommended."
lastModified: "2026-10-09T08:43:45.175Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
