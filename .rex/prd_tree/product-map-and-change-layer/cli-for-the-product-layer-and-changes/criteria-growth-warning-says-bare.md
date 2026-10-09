---
id: "e9494e36-082f-4ffb-88de-54360af1a158"
level: "task"
title: "criteria-growth warning says bare \"criteria\" instead of \"capability criteria\""
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The criteria-growth message reads \"capability criteria\" (assertion in v2-rules.test.ts)"
description: "Verdict: should-fix (low).\n\nScenario: `rex health` on a v2 tree prints `Capability \"X\" carries 16 criteria (...; threshold 15)`. The PR 18 design boundary says never to use a bare \"criteria\" in help text or errors. Since f5d8c06e, `rex health` shows this message to users.\n\nEvidence: packages/rex/src/schema/v2-rules.ts:734 (the criteria-growth message). packages/rex/tests/unit/schema/v2-rules.test.ts asserts toContain(\"16 criteria\"), which is why it was left alone in f5d8c06e.\n\nFix: change the message to \"carries 16 capability criteria\" and update that assertion. Cost: trivial.\n\nScope note (overnight 2026-10-09): changing this message string in packages/rex/src/schema/v2-rules.ts is in scope for PR 18. It is user-visible text, not a change to the v2 schema shape, which the PR 18 boundary freezes."
lastModified: "2026-10-09T06:47:43.371Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
