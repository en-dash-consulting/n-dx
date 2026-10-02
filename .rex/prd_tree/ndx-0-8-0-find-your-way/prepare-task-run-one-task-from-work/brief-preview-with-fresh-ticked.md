---
id: "14da75c7-031f-4c99-92c1-34f545a1cb46"
level: "task"
title: "Brief preview with Fresh ticked deletes the orientation session cache"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ndx work --task=<id> --dry-run --fresh` leaves .hench's session cache intact; a hench test seeds a cache file and asserts it survives."
  - "A real run with --fresh still clears the cache."
description: "Verdict: must-fix (introduced: the preview route is documented as writing nothing, and the next real run pays to re-orient).\n\nScenario: in the modal tick Session: Fresh and press Preview brief. POST /api/hench/prep/:taskId/preview passes --fresh to `ndx work --dry-run` (routes-hench-prep.ts:234 via runOptionArgs), and packages/hench/src/cli/commands/run.ts:1992-1993 runs `if (fresh) await clearSessionCache(henchDir)` with no dryRun guard. routes-hench-prep.test.ts:278-286 asserts --fresh is forwarded, which pins the bug.\n\nFix (recommended): guard with `if (fresh && !dryRun)` in hench and print 'would discard the cached session' in dry runs; keep forwarding --fresh so the preview reflects the setting. Alternative: strip fresh from the preview argv (hides the setting from the brief).\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:29:30.450Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
