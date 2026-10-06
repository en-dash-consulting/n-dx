---
id: "c34545b5-13a6-4664-88a8-3c9c06a35d23"
level: "task"
title: "long-revised measures revision age from lastModified, which any state write resets"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-07"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A capability whose spec hash has differed from metAt for longer than the threshold warns long-revised even when a later state write (checks, specReviewed) updated lastModified"
  - "A unit test in packages/rex/tests/unit/schema/v2-rules.test.ts covers that case and fails against the current lastModified-based rule"
  - "The field or option that carries the revision time is documented in v2.ts or v2-rules.ts"
description: "Verdict: should-fix (medium).\n\nScenario: a capability's statement is edited 60 days ago, so specHash no longer equals metAt, and no change is opened. Its requirement checks run every night, and each run writes `checks` to state.yaml. The writer re-stamps `lastModified` on every content change (v1 behavior: packages/rex/src/core/sync.ts:428-436). So the age the rule sees is always under a day, and `long-revised` never warns. Setting `specReviewed` or any other state write does the same.\n\nEvidence: packages/rex/src/schema/v2-rules.ts, the longRevised rule, `const modified = node.lastModified ? Date.parse(node.lastModified) : NaN`.\n\nReachable: not yet; v2-rules.ts is wired to nothing. It becomes reachable once the state writer (PR 8) and health (PR 11) call checkV2Rules. It should be fixed now, because this feature exists so that no later PR has to edit the schema files.\n\nOptions:\n1. Add a `revisedAt` state field, stamped when a spec edit first makes the hash differ from metAt and cleared on re-stamp. The rule reads that field. Cost: one schema field plus a writer duty. Recommended.\n2. Measure age from the last git commit that touched the node's intent .md. This needs git, so the rules would no longer be pure; rejected.\n3. Have the caller supply `revisedSince(node)` through RuleOptions. This keeps the schema as it is, but pushes the definition onto every caller.\n\nDecision for the owner: whether to add `revisedAt` to the v2 state schema.\n\nDecision (Ryan, 2026-10-06): option 1. Add an optional `revisedAt` timestamp to the v2 item state schema (state.yaml), documented in the v2.ts header table: stamped when a spec edit first makes the spec hash differ from metAt, cleared when metAt is re-stamped. The longRevised rule reads `revisedAt`, not `lastModified`. Do not implement the writer duty here (v2 is wired to nothing); document it for the state writer PR."
lastModified: "2026-10-06T14:26:06.517Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
