---
id: "9d4329d2-74ce-445d-9e16-3cc206a6c201"
type: "change"
title: "Apply-engine refusals say bare \"criteria\": \"a constraint has no criteria\", \"a new capability has no criteria to replace or remove\""
slug: "apply-engine-refusals-say-bare"
intent: "Verdict: out-of-scope (pre-existing). Found by the adversarial review of 7e46ba62, which fixed the same wording in the capability-criteria health warning.\n\nScenario: on a v2 tree, `rex change apply` (or add_item / place_change, which dry-run apply) on an amendment with a criteria delta on a constraint prints \"a constraint has no criteria\". The same goes for \"a new capability has no criteria to replace or remove\". The PR 18 design boundary says help text and errors never use a bare \"criteria\".\n\nEvidence: packages/rex/src/core/apply-amendments.ts:309, :325, :400 (and the doc comment at :16).\n\nReachable: rex change apply, MCP apply_change, add_item and place_change on a v2 tree.\n\nFix (recommended): reword to \"has no capability criteria\", e.g. \"a constraint has no capability criteria; state it in proposed and list its requirements\". Then update the exact-string assertions in tests/unit/core/apply-amendments.test.ts, change-place.test.ts, change-add.test.ts and tests/integration/v2-mcp-place-apply.test.ts. Cost is trivial; this is user-visible text, not a schema change."
acceptanceCriteria:
  - "apply-amendments refusals read \"has no capability criteria\" and no refusal says \"has no criteria\" (asserted in apply-amendments.test.ts)"
  - "change-add, change-place and v2-mcp-place-apply tests assert the new wording"
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
