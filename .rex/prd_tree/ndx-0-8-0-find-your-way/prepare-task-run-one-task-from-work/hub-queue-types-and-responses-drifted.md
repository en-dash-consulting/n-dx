---
id: "a3931428-741c-4c2b-b3ba-9a17eda3a368"
level: "task"
title: "Hub queue types and responses drifted from run options, and the unscoped queue exposes other projects' notes"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "hub"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The queued 202 echoes the accepted options; HubQueueEntry includes options; GET /api/hub/queue never includes contextNotes text (tests)."
description: "Verdict: should-fix.\n\nScenario: the hub's queued 202 (proxy.ts:497) does not echo accepted options while the server's 202 does; the viewer's HubQueueEntry (viewer/hooks/use-hub-queue.ts:43, documented as mirroring QueueEntry) lacks options; unscoped GET /api/hub/queue returns every project's entries including up to 8 KB of contextNotes each. Fix (recommended): echo options in the queued 202; update HubQueueEntry; strip contextNotes (keep a hasNotes flag) from queue snapshots.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:30:10.596Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
