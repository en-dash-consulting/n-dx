---
id: "2d91dabf-a7fc-4e11-b100-68380ee0c3ff"
level: "task"
title: "Start now and Ready to run queued notices never learn the run was dropped"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "hub"
  - "web-viewer"
source: "hench follow-up of a6823846"
acceptanceCriteria:
  - "A run started from Start now or Ready to run that is dropped at replay shows 'Could not start: <reason>' (unit tests)."
  - "Their queued position stays current from the hub queue, as the modal's does."
description: "After a6823846, GET /api/hub/queue carries `dropped` entries (status + server error) and the Prepare task modal's QueuedNotice shows \"Could not start: <reason>\" via droppedEntryOf (viewer/hooks/use-hub-queue.ts). Two other surfaces still render a one-shot static string from the 202 reply and never update: start-task-button.ts:125 (the one-click \"Start now\" path) and ready-to-run.ts:117. A run dropped at replay still reads \"Queued — position N\" there. Make both poll useHubQueue while queued (or reuse the modal's QueuedNotice) so position, admission and drop are shown the same way.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T12:22:07.590Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
