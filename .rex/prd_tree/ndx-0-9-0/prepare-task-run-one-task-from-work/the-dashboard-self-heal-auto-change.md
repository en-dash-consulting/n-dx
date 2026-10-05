---
id: "0f343cdc-d118-40e1-83ef-ed658f998a99"
level: "task"
title: "The dashboard Self-Heal --auto change has no changeset"
status: "completed"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "release"
source: "ndx-adversarial-review"
startedAt: "2026-10-02T12:16:47.570Z"
completedAt: "2026-10-02T12:21:53.285Z"
endedAt: "2026-10-02T12:21:53.285Z"
resolutionType: "code-change"
resolutionDetail: "Added patch changeset for @n-dx/web describing dashboard Self-Heal --auto and the consent step."
acceptanceCriteria:
  - "A patch changeset for @n-dx/web describes the Self-Heal --auto change and the dashboard consent step that replaces the CLI prompt."
description: "Verdict: should-fix (cheap; release notes).\n\nScenario: commit 05316436f changed routes-commands.ts:791 to pass --auto, which also bypasses self-heal's own confirmation, but no .changeset entry describes it. Confirm the viewer's 'I understand — proceed' step runs before the POST and say so in the changeset. Fix: add a patch changeset for @n-dx/web describing the change and the consent step.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T12:21:53.696Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
