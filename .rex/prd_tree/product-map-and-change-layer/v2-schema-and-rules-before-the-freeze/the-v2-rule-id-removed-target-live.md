---
id: "e6444308-912e-48a0-a805-1fb96a822223"
level: "task"
title: "The v2 rule id removed-target-live names only removals but now reports touches, modified targets and added under"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The v2 rule that reports an open change's references to retired product nodes has an id that does not name only removals, or the decision to keep removed-target-live is recorded on this item"
  - "tests/unit/schema/v2-rules.test.ts references the chosen rule id for touches, modified, removed and added-under cases"
description: "Found by the adversarial review of task 2f000cd0. Verdict: should-fix, low severity. No behaviour fails today. It is naming drift that the 1.0.0 freeze would make permanent.\n\nScenario: an open change `{touches: [\"gone\"]}` against a deleted capability \"gone\" is reported as rule `removed-target-live`, although nothing is removed. Rule ids reach users in findings and any later filtering or suppression config, so renaming after 1.0.0 breaks consumers. The rule is in packages/rex/src/schema/v2-rules.ts: `V2RuleId` around line 61, `RULE_SEVERITY` line 188, and the `removedTargetLive` rule around line 508.\n\nReachable: through checkV2Rules once v2 trees are read. Today the rules are wired to nothing.\n\nOptions:\n(a) Recommended. Rename the rule id to something like `open-change-refs-live` before the freeze. Update the rule table, the tests and a patch changeset. Cost is small. Risk: none outside rex, because the rules are not wired yet.\n(b) Keep the id and document that it covers every product reference of an open change. This is free, but the misleading name stays forever.\n\nDecision for Ryan: rename (a) or keep (b)."
lastModified: "2026-10-08T01:10:46.806Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
