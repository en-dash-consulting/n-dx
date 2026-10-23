---
id: "7e46ba62-91df-43f3-86e5-7c647bd8062b"
type: "change"
title: "capability-criteria warning says bare \"criteria\": \"Capability X has no criteria\""
slug: "capability-criteria-warning-says-bare"
intent: "Verdict: out-of-scope (pre-existing). Found by the adversarial review of e9494e36, which fixed the same wording in the criteria-growth message only.\n\nScenario: running `rex health` on a v2 tree that has a capability with no criteria prints `Capability \"X\" has no criteria`. The PR 18 design boundary says help text and errors must never use a bare \"criteria\". This message has the same defect e9494e36 fixed in criteria-growth.\n\nEvidence: packages/rex/src/schema/v2-rules.ts:646 (the capabilityCriteria rule).\n\nReachability: rex health on a v2 tree, which runs the v2 rules.\n\nFix: change the text to `has no capability criteria` and add or update the assertion in packages/rex/tests/unit/schema/v2-rules.test.ts. Cost is trivial; this is user-visible text, not a schema change. Recommended."
acceptanceCriteria:
  - "The capability-criteria finding message reads \"has no capability criteria\" (assertion in v2-rules.test.ts)"
touches:
  - "70443075-8352-48a4-a8ed-799505872d4b"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
---
