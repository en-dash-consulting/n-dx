---
id: "b19433c4-1594-42a9-85e4-f1c728f42363"
level: "task"
title: "`ndx work --resolve=<value>` starts a real run instead of resolving"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`--resolve=yes` and `--resolve=true` resolve and never start a run; `--resolve=false` behaves as no flag or is rejected; tests in core and hench."
description: "Verdict: should-fix (low severity, but a flag named resolve must never run).\n\nScenario: `ndx work --task=X --resolve=yes .` fails core's flags.includes('--resolve') (packages/core/cli.js:2089), so core prints the identity line, applies the vendor gate and installs the Ctrl+C handler; hench sees resolve='yes' (not 'true') and falls through to cmdRun (packages/hench/src/cli/index.ts:157) — a real run. Fix (recommended): core matches `--resolve` and `--resolve=*`; hench treats any resolve value other than 'false' as resolve, or rejects other values with an error.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:29:54.541Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
