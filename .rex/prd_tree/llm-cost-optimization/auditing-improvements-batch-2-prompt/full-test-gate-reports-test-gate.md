---
id: "3add28fd-773d-432e-8214-6969c093ca5e"
level: "task"
title: "Full test gate reports 'Test gate failed: ' with 0/0 packages, dropping the timeout or exec error that actually failed it"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
  - "test-gate"
  - "observability"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "When `runTestGate` returns `error: \"Test command timed out\"`, `run.error` contains the words `timed out`, the command, and the elapsed seconds"
  - "When the gate fails with no parsed packages, the console line and `run.error` say that no per-package results were parsed instead of printing `0/0 package(s) failed`"
  - "The last 200 lines of the gate's combined stdout/stderr are appended to the run log and stored on `run.diagnostics`"
  - "A passing gate on this repo's `npm run test` output does not report any package as failed"
  - "Unit tests cover the timeout, spawn-error, and no-packages-parsed messages and fail on the current code"
description: "Severity: medium. Verdict: should-fix. Observed while monitoring the first `ndx work --review` run on this branch (run 80c716ff, 2026-09-07).\n\n## Failure scenario\nThe run's Full Test Suite Gate auto-detected `npm run test`, ran for 5m20s, and the run ended `status: failed` with `run.error = \"Test gate failed: \"` and the console line `[Test Gate] ✗ 0/0 package(s) failed`. The suite had not failed: the same gate call reproduced against the same worktree passed in 198s. The gate had hit its 5-minute timeout under CPU contention, and nothing in the output said so.\n\nThree defects combine:\n1. `packages/hench/src/agent/lifecycle/shared.ts:2060` builds the error as `Test gate failed: ${failedPackages.join(\", \")}` and never includes `testGate.error`, so `runTestGate`'s own diagnosis (`\"Test command timed out\"`, spawn failure, output overflow) is discarded. When no packages parsed, the message is empty.\n2. `parseVitestOutput` in `packages/hench/src/tools/test-runner.ts` expects vitest's JSON reporter. For a plain runner such as this repo's `scripts/run-all-tests.mjs` it parses nothing, so every failure is `0/0`, and on a passing run it produced a spurious `sourcevision: failed` entry from a stray line, so the per-package table is wrong in both directions.\n3. The gate's stdout and stderr are not written to the run log (`.run-logs/<run>.log` holds only the `0/0` line), so the operator cannot recover the cause after the fact.\n\n## Reachability\nEvery `ndx work` run whose gate command is not a vitest JSON-reporter invocation, which is the auto-detected default for this repo. Any timeout, spawn failure, or overflow is reported as an empty failure.\n\n## Solution options\n1. (Recommended) Compose the message from what is known: `Test gate failed (<command>, exit <code|timeout> after <n>s): <testGate.error ?? failed packages ?? 'no per-package results parsed'>`. Persist the tail of the gate's stdout/stderr (last ~200 lines) into the run log and `run.diagnostics`, and only render the per-package table when at least one package parsed. Cost: small, one function plus a test. Risk: none.\n2. Also switch the auto-detected command to request the JSON reporter where the test runner is vitest, so the package table becomes meaningful. Larger, and this repo's runner is a script rather than vitest directly, so it does not help here.\n\nOption 1 fixes the reporting regardless of runner."
lastModified: "2026-09-07T23:02:59.990Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
