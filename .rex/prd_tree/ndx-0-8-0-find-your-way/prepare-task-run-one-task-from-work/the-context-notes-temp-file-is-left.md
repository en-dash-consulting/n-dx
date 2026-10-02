---
id: "1cedc472-0766-44a5-a758-06ff5736d925"
level: "task"
title: "The context-notes temp file is left behind on spawn failure, write failure and shutdown"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-server"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A spawn that throws synchronously, and a writeFile that fails, leave no ndx-context-* file or directory behind (tests)."
  - "Server shutdown awaits pending context-file removals; startup removes stale ndx-context-* directories older than a day (tests)."
description: "Verdict: should-fix.\n\nScenario: in routes-hench.ts (:1975 vs :2004/:2126) and server/run-options.ts writeContextNotesFile: a synchronous throw from spawn after the file is written leaves file and directory; mkdtemp succeeding then writeFile failing (ENOSPC) leaves an empty directory; on shutdown, remove() in .finally is not awaited. The path is unpredictable and 0600, so this is leakage of operator notes in tmp, not exposure. Fix (recommended): try/catch around spawn that removes the file; remove the directory when writeFile fails; await pending removals in shutdown; sweep stale ndx-context-* directories at startup.\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:30:07.936Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
