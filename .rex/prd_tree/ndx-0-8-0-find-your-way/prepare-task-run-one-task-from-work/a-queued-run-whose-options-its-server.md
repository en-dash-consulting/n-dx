---
id: "a6823846-d860-489f-8cbe-b45c7a9767d8"
level: "task"
title: "A queued run whose options its server refuses at replay disappears without telling anyone"
status: "in_progress"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:high"
  - "hub"
  - "web-server"
source: "ndx-adversarial-review"
startedAt: "2026-10-02T08:50:34.373Z"
acceptanceCriteria:
  - "A queued execute with options the project server would refuse is answered with that 4xx at enqueue time, not 202 queued (integration test)."
  - "A queued entry refused at replay appears in GET /api/hub/queue as dropped with the server's status and message, and the Prepare task modal's queued notice shows it (tests)."
  - "A live-catalog model chosen in the modal still validates after the catalog cache expires."
description: "Verdict: must-fix (introduced: options now travel through the queue, and new refusals exist).\n\nScenario: with the machine at its session cap, POST /p/<id>/api/hench/execute with options the hub accepts by shape but the project server refuses — a model only in the live catalog after its 10-minute cache expired, provider api on codex, a task that became blocked, or an in-progress task now held by a live run. The hub answers 202 queued (packages/web/src/hub/proxy.ts:462-477 only shape-checks); on drain the server answers 400/409 and the entry is removed with a hub log line only (packages/web/src/hub/admission.ts:328-330). The modal showed 'Queued — position N'; the run never starts and nothing says why. routes-llm.ts validateCatalogModel only peeks the live-catalog cache.\n\nFix (recommended, both parts): (1) before answering 202 queued, ask the project server to validate the request without starting it (a validate-only mode of execute, or reuse the preview validation) and return its 4xx directly; (2) when a replay is refused anyway, record the dropped entry with the server's status and error in the queue snapshot (and onChange), so useHubQueue and the modal can show 'could not start: <reason>'. Also make replay validation fetch the live catalog instead of only peeking the cache.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:51:33.671Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
