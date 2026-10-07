---
id: "8adab30c-4e45-4f70-9046-805bf8718bd3"
level: "task"
title: "isReadOnlyRefusal returns false when earlier attempts already committed the task's files"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "retry"
  - "read-only-refusal"
  - "539"
blockedBy:
  - "3703ed63-1fb3-4ab5-8f4e-48161cca4632"
source: "ndx-capture"
startedAt: "2026-10-06T19:13:07.533Z"
completedAt: "2026-10-06T19:22:42.483Z"
endedAt: "2026-10-06T19:22:42.483Z"
resolutionType: "code-change"
resolutionDetail: "isReadOnlyRefusal takes priorAttemptWorkOnBranch; cliLoop computes it once via prior-attempt-work.ts; rejection message and diagnostics note name the earlier work"
acceptanceCriteria:
  - "isReadOnlyRefusal returns false when the branch has commits since the task's first attempt that touch files earlier attempts of the task changed."
  - "In that case no cold re-spawn happens, and the no-changes rejection names the earlier work and points to a gate-only retry or `ndx rex update --status=completed`."
  - "The #473 read-only refusal cases with no earlier task work still re-spawn cold."
  - "Git failures while computing the check fall back to today's behaviour."
description: "#539 item 1, second bullet. Task 5 of 7. It follows task 4 because both touch `processSuccessfulResult` / `cliLoop` in cli-loop.ts.\n\n**The problem.** `isReadOnlyRefusal` (packages/hench/src/agent/lifecycle/read-only-refusal.ts:54) is `forked && noChanges && countFileEditCalls(toolNames) === 0`. It was added for #473: a forked session whose inherited orientation turn wins, so it never tries to edit. On a retry of work an earlier attempt already committed, the agent correctly finds nothing to do. That looks identical, so hench throws the session away and re-spawns cold (cli-loop.ts:1831 → 2683-2694), and the cold session re-verifies everything again. Task 4 removes the main case (held completion plus gate failure). This task covers the rest: the earlier attempt committed the work and then failed for any other reason (timeout, livelock, a gate failure without a hold, a dirty tree that blocked gate-only).\n\n**Change.**\n- Add a field to the `isReadOnlyRefusal` input, for example `priorAttemptWorkOnBranch: boolean`. When it is true, the function returns false.\n- Compute it in `cliLoop` from `opts.runHistory`, once per run, before the spawn loop:\n  - The first attempt is the oldest run for this taskId with a `startHead` that is still an ancestor of HEAD. Reuse task 4's is-ancestor helper.\n  - The task's files are the union of the earlier runs' `structuredSummary.filesChanged`.\n  - The value is true when `git diff --name-only <firstStartHead>..HEAD` (excluding `.rex/`, `.hench/`, `.hench-commit-msg.txt`, as `validation/completion.ts` BOOKKEEPING_EXCLUDES does) intersects the task's files.\n  - Pass it through `SuccessContext` (cli-loop.ts:1703), which has no runHistory today.\n  - Git errors mean false. Keep today's behaviour when unsure.\n- When the read-only refusal is suppressed this way, the completion is still rejected for having no changes. That path is unchanged, and fixing it is #504. Change the rejection message and the rex log detail so the operator learns three things:\n  1. the task's files were already committed by earlier attempts (name the run ids or commit count);\n  2. if those runs failed only at the test gate, retry for a gate-only run;\n  3. otherwise verify the work and mark the task with `ndx rex update <id> --status=completed`.\n- Record the suppression on the run, for example in diagnostics notes `read_only_refusal_suppressed: prior attempts committed <n> task files`.\n\n**Tests.**\n- Unit tests in `tests/unit/agent/read-only-refusal.test.ts` for the new input.\n- An integration case beside `tests/integration/read-only-refusal-retry.test.ts`: earlier runs committed the task's files, so the forked session's no-edit result does not cold re-spawn and the message names the earlier work. The existing #473 cases must still re-spawn cold.\n\n**Validation.**\n- `pnpm --filter @n-dx/hench exec vitest run tests/unit/agent/read-only-refusal.test.ts tests/integration/read-only-refusal-retry.test.ts <new files>`.\n- `pnpm --filter @n-dx/hench typecheck` and build.\n- Do not run the full suite."
lastModified: "2026-10-06T19:22:42.919Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
