---
id: "14011976-069e-45b3-a4c8-ec155ff9dd7c"
level: "task"
title: "tokenBudget has no upper bound, so a huge value runs with a budget of 1"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-server"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "tokenBudget above Number.MAX_SAFE_INTEGER (or any value whose decimal form is not plain digits) answers 400 naming the key; a test covers 1e21."
  - "Every integer option serializes as plain decimal digits; a test asserts it."
description: "Verdict: should-fix.\n\nScenario: {\"options\":{\"tokenBudget\":1e21}} passes Number.isInteger, becomes `--token-budget=1e+21` (packages/web/src/shared/run-options.ts:71 has only min: 0; :159 uses String(value)), and hench's parseInt reads 1 — the run hits its budget immediately while the 202 echoes 1e21. Fix (recommended): add max: Number.MAX_SAFE_INTEGER to integer specs and require the serialized value to match /^\\d+$/; add the same bound to the modal's number input."
lastModified: "2026-10-02T07:47:34.944Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
