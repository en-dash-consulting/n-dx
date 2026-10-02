---
id: "ead2b95c-a42d-49ab-aae7-ee9dd2add24d"
level: "task"
title: "The Live idle card and Workspaces cards never offer Resume for an in-progress task"
status: "completed"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-viewer"
source: "ndx-adversarial-review"
startedAt: "2026-10-02T11:12:40.761Z"
completedAt: "2026-10-02T11:22:45.668Z"
endedAt: "2026-10-02T11:22:45.668Z"
resolutionType: "code-change"
resolutionDetail: "Live idle card and Workspaces cards now render TaskStartControl; next-task payloads carry status/blockedBy; tests added."
acceptanceCriteria:
  - "The Live idle card and Workspaces cards show Resume for an in-progress task with no live run, blockers for a blocked task and a Live link while a run is live; tests cover each."
description: "Verdict: should-fix (criterion of task e403f6ec unmet on two surfaces).\n\nScenario: views/live.ts:475 and views/workspaces.ts:528 use StartTaskButton directly instead of TaskStartControl, so an in-progress next task with no live run shows 'Start working', not Resume, and these cards skip the shared startOffer rule (blocked tasks, live-run link). Fix (recommended): route both through TaskStartControl (passing workspace) so every surface shares one offer rule.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T11:22:46.085Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
