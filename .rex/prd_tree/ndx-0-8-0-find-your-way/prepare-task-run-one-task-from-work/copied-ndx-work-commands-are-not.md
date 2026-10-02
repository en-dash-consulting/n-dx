---
id: "2d0088bb-02cc-404e-8f92-e7ca79a219c0"
level: "task"
title: "Copied ndx work commands are not runnable: an unquoted notes placeholder and POSIX-only quoting"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-viewer"
  - "hench"
  - "windows"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The copied command with notes set is valid shell syntax (test parses it with a POSIX tokenizer)."
  - "On win32 the resolve command quotes a path with spaces using double quotes; a test covers it."
description: "Verdict: should-fix. Bundled: both make a copied command fail when pasted into a shell.\n\nScenario 1: with notes set, the modal's command (components/prepare-task-model.ts:236-238) contains `--context-file=<notes-file>`; pasted into a shell, < and > are redirects ('notes-file: No such file'). Scenario 2: run-resolve.ts:357-359 single-quotes paths with spaces or backslashes, which cmd.exe and PowerShell do not understand.\n\nFix (recommended): quote the placeholder (or omit it and say notes are not in the copied command); quote per platform (double quotes on win32).\n\n## Checks before committing (operator note)\n\nhench's test gate runs `npm run test` at the project root, which includes ROOT policy tests (tests/e2e/*, tests/integration/*) that no package suite runs: gateway export caps (architecture-policy), gateway contract lists (cross-package-contracts), the wall-clock assertion inventory, domain isolation and boundary checks. If you add a gateway export, a clock-bound test or a cross-package import, update those. Before committing run, from the project root: `npx vitest run tests/e2e tests/integration`, plus `npx vitest run` and `npx tsc --noEmit` from each package you touched. `pnpm` is not permitted in this sandbox. Add a patch changeset (scoped name) for each package you change."
lastModified: "2026-10-02T08:30:02.580Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
