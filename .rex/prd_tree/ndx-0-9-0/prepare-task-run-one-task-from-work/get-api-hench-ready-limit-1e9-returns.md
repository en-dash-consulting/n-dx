---
id: "228f060a-3767-4acc-b1cd-489a6ee17f7c"
level: "task"
title: "GET /api/hench/ready?limit=1e9 returns one row instead of the maximum"
status: "completed"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-server"
source: "ndx-adversarial-review"
startedAt: "2026-10-02T11:40:04.653Z"
completedAt: "2026-10-02T11:46:47.512Z"
endedAt: "2026-10-02T11:46:47.512Z"
resolutionType: "code-change"
resolutionDetail: "readyLimit uses Number() + Number.isInteger, clamps 1..50, default otherwise; tests added."
acceptanceCriteria:
  - "limit=1e9 returns up to 50 rows, '10abc' and 'abc' use the default, and 0 or negative values clamp to 1; tests cover each."
description: "Verdict: should-fix (cheap).\n\nScenario: readyLimit (routes-hench-prep.ts:252) uses parseInt, so '1e9' → 1, '10abc' → 10, and 0 or negatives become 1. Fix (recommended): Number(raw), require Number.isInteger, clamp to 1..50, fall back to the default for anything else.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T11:46:47.908Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
