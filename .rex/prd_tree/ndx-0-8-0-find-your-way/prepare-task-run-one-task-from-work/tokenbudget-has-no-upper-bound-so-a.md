---
id: "14011976-069e-45b3-a4c8-ec155ff9dd7c"
level: "task"
title: "tokenBudget has no upper bound, so a huge value runs with a budget of 1"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-server"
source: "ndx-adversarial-review"
startedAt: "2026-10-02T09:39:21.313Z"
acceptanceCriteria:
  - "tokenBudget above Number.MAX_SAFE_INTEGER (or any value whose decimal form is not plain digits) answers 400 naming the key; a test covers 1e21."
  - "Every integer option serializes as plain decimal digits; a test asserts it."
description: "Verdict: should-fix.\n\nScenario: {\"options\":{\"tokenBudget\":1e21}} passes Number.isInteger, becomes `--token-budget=1e+21` (packages/web/src/shared/run-options.ts:71 has only min: 0; :159 uses String(value)), and hench's parseInt reads 1 — the run hits its budget immediately while the 202 echoes 1e21. Fix (recommended): add max: Number.MAX_SAFE_INTEGER to integer specs and require the serialized value to match /^\\d+$/; add the same bound to the modal's number input.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T09:39:21.729Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
