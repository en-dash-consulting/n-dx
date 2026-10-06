---
id: "77d08c50-2cf1-4429-ac8f-982eece8d061"
level: "task"
title: "v2 schema field coverage is checked against a reconstructed field list, not the design doc's intent/state tables"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-07"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Every field in the design doc's intent table appears in the matching *IntentSchema in packages/rex/src/schema/v2.ts"
  - "Every field in the design doc's state table appears in ItemStateSchema"
  - "The coverage lists in tests/unit/schema/v2.test.ts are copied from the doc's tables and the test passes"
  - "Placement of issues, checks, specReviewed and the display-id forms matches the doc or the doc is corrected"
description: "Verdict: should-fix. The run that built packages/rex/src/schema/v2.ts could not open the design doc (n-dx 1.0.0: Product Map, Change Layer and the v2 Schema, Claude Doc 90af941f…; no Claude Docs connector), so its field list came from the v2-cut decisions memory (C2), the task description and docs/process/prd-storage-v2-migration.md §4.2. The field-coverage test in packages/rex/tests/unit/schema/v2.test.ts ('field coverage (design intent/state tables)') asserts that reconstruction, so it is circular: a field in the doc's tables but missing from the reconstruction passes today. The review already found one such gap (loe, fixed in the same run). Scenario: the doc's state table lists e.g. a manual shippedIn override flag or a per-check field; v2.ts has no type for it; PR 9 (reader/writer) must edit the schema file, breaking the feature's 'no later PR edits the schema files' goal. Unchecked choices to confirm: issues stored in state next to prs; field names checks/specReviewed; display-id forms CH-n[.n] and An[.n]; statement/criteria optional on capabilities. Fix: open the doc, diff its intent and state tables against v2.ts, add missing fields, update COMMON_INTENT/STATE lists in the coverage test. Cost: small; risk: none (v2.ts is unwired).\n\nDecision (Ryan, 2026-10-06): add `summary` (optional string) to AreaIntent and AreaIntentSchema, with a test, and add it to the coverage list. A manual diff of v2.ts against the design doc's node-type table (Area: title, summary, stewards; Capability: statement, criteria, requirements, dependsOn; Constraint: statement, requirements, appliesTo; Change: intent, amends, touches, plannedRelease, prs, issues, assignee, priority, spike) and its intent/state table found area `summary` to be the only missing field. issues next to prs in state, checks, specReviewed and the CH-n / An.n display-id forms already match the doc; leave them as they are."
lastModified: "2026-10-06T14:26:04.546Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
