---
"@n-dx/hench": patch
---

fix(hench): stop failing a run for a test suite that never started

`runTestGate` inferred pass/fail from `exitCode` alone. A command that cannot
be spawned comes back from `exec` as exitCode 1 with empty stdout and stderr —
byte for byte what a real failing exit looks like — so the only thing separating
"your tests failed" from "the suite never started" is `ExecResult.launched`,
which was never read.

The consequences ran well past a misleading message. In autonomous mode the gate
failure aborted the run, which set `run.status = "failed"`, which skipped
`updateCompletedTaskStatus` and short-circuited the commit prompt. Finished,
committed work went unrecorded in the PRD, the loop re-selected the same task,
and three strikes auto-cancelled it. Operators saw `✗ 0/0 package(s) failed` and
`Test gate failed:` with nothing after the colon. On Windows without a POSIX
shell this fired on essentially every task until b5a3a3e0 fixed shell resolution.

Now:

- A gate that could not be executed is reported as `ran: false` with an error
  naming the spawn failure — inconclusive, not a verdict. `TestGateResult` says
  so explicitly: check `ran` before `passed`.
- The lifecycle treats that as inconclusive and leaves `run.status` alone, so the
  PRD write and the commit still happen, and prints a distinct message rather
  than claiming a test failure.
- The retry loop terminates instead of spinning to the 5-attempt cap re-running a
  command that cannot launch, then failing the run for exhausting its retries.
- A gate failure with no package results names a reason instead of ending in a
  bare colon.

The same `launched` gap is fixed in `runTestsForFiles`, `runTypecheck` (cleanup
transformations — still fails closed, since it guards a mutation, but no longer
reports a spawn failure as type errors), and completion validation. The rex
requirements executor folds the spawn error into stderr, since its contract has
no field for it. `runDependencyAudit` was left annotated and tracked separately,
because its fail-open behaviour was a design decision about a security-adjacent
check rather than a mechanical one; it is fixed in its own changeset.
