---
id: "7e8d199b-2322-49e1-bc0f-ef027e92d205"
level: "task"
title: "Add hench check-runs to audit and end dead runs from the CLI, across every worktree of the repository"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "run-liveness"
  - "adopted-from-pr-484"
blockedBy:
  - "fb20ed48-0a1e-4c82-b556-a5a7a1dc8d9d"
source: "adopted from draft PR #484 (fix/running-task-audit), adapted to the Live branch's decisions, 2026-10-01"
startedAt: "2026-10-01T21:49:56.836Z"
completedAt: "2026-10-01T21:57:43.251Z"
endedAt: "2026-10-01T21:57:43.251Z"
acceptanceCriteria:
  - "hench check-runs lists every running record in every worktree with its verdict and reason (test with two worktrees)."
  - "--fix ends only orphaned runs (and unknown with --include-unknown) using the shared error prefix (test)."
  - "--strict exits 1 when any running record is not live; --format=json emits the verdicts (tests)."
  - "ndx hench check-runs works, help lists the command, and cli-arg-contracts covers it."
  - "Changeset for @n-dx/hench (patch)."
description: "Adapt #484's `hench check-runs` (`git show refs/review/pr-484:packages/hench/src/cli/commands/check-runs.ts`, help text in `cli/help.ts`, registration in `cli/index.ts` and `commands/constants.ts`, tests in `tests/unit/cli/commands/check-runs.test.ts`, and the `tests/e2e/cli-arg-contracts.test.js` entry). Keep its flags and exit codes: `--fix` ends orphaned runs, `--include-unknown` widens that, `--strict` exits 1 when any running record is not live (a CI pre-flight), `--format=json` for scripts. Use the hench verdict from this branch (pid first, then locks). Unlike #484 it audits every worktree of the repository, grouped by worktree, using hench's existing git worktree helpers through its gateway; `--worktree=<path>` narrows to one. Ending writes the same status and error prefix as the dashboard's reconcile route. Reachable as `ndx hench check-runs`."
lastModified: "2026-10-01T21:57:43.592Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
