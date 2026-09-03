---
id: "02351b92-4b60-43cf-b1bc-317ea895e39f"
level: "task"
title: "Test gate must not fail a run for a suite it never executed"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "test-gate"
  - "reliability"
  - "prd-completion"
source: "ndx-capture"
acceptanceCriteria:
  - "runTestGate propagates the execution error and reports a gate it could not execute as `ran: false` with a reason, never as `passed: false`"
  - "An inconclusive gate does not flip run.status to failed, so the PRD completion write and the commit still proceed"
  - "The gate failure message names the failing packages, or states that the gate could not run — never an empty list after a trailing colon"
  - "The retry loop in shared.ts:2013 terminates when `ran: false` and no `skipReason` is set, instead of spinning to the 5-attempt cap"
  - "Regression test covers an unexecutable test command and asserts the run stays completed with the PRD status written"
description: "Runs `7e18e4cb-1bfa-4614-8ce7-ab406db72daa` and `606de551-d29a-4aca-94f6-31d1d97ce114` (both task `34de0ad2-57d6-4523-8cab-9211452280a3`) each recorded `status: failed` with `error: \"Test gate failed: \"` and `testGate: {ran: true, passed: false, packages: [], command: \"npm run test\", totalDurationMs: 1}` — the suite never started. `runTestGate` (`packages/hench/src/tools/test-runner.ts:586`) destructures only `{stdout, stderr, exitCode}` and discards the `error` returned by `execShellCmd`, then infers pass/fail from `exitCode` alone (`:608`), so an unlaunchable command scores as a test failure. In autonomous mode that aborts immediately (`shared.ts:577`), setting `run.status = \"failed\"` (`shared.ts:2059`), which skips `updateCompletedTaskStatus` (`shared.ts:2080`) and short-circuits `performCommitPromptIfNeeded` (`shared.ts:1543`) — so completed, committed work is never recorded in the PRD, and the loop re-selects the same task until the 3-strike auto-cancel fires (`run.ts:1733`). In both runs the agent had already run the suites green via its own Bash tool and committed `a75fe556`; the task reached `completed` only because the agent called `update_task_status` itself at 13:10:38, ~50s before the harness declared failure. Root cause of the unlaunchable shell is tracked separately as `72422229-4ca2-476d-9fa9-95ff8b6f8362`; this task is the defense-in-depth that turns it into a loud, correct diagnosis instead of a false failure with a suppressed PRD write."
lastModified: "2026-09-03T14:02:15.448Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
