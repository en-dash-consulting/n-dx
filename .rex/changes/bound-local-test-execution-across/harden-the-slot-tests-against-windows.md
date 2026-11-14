---
id: "1ec3f9f1-5362-4345-8cce-0b7910813b27"
type: "task"
title: "Harden the slot tests against Windows pid reuse and fix the API-run docs"
slug: "harden-the-slot-tests-against-windows"
summary: "Some slot tests assume a process number from a just-ended process stays unused, which is not true on Windows under load, and one test has too tight a time limit. A doc line also still says Ctrl-C cannot stop an API run's wait. This makes the tests reliable and corrects the docs."
description: "PR 2 (#1034) review by Hal, 2026-11-14 (thread 4570835463 plus review-body P3 points).\n\n1. [P2] `deadPid()` in `packages/hench/tests/unit/process/validation-slot.test.ts` (around line 41) returns a just-exited child's pid. It is the default pid in `writeHolder` and is used by the reclaim tests (around lines 202, 211, 252 and 291). Windows reassigns freed pids quickly under CI load. When it does, the reclaim tests (which acquire without a signal) hang until the 120 s timeout, and the test at line 252 fails its `holderAlive === false` assertion. This is the pattern bc27aa0dd removed from eight other files.\n   Fix: make `deadPid()` return `2 ** 30`, which is above Linux's `pid_max`, macOS's 99999 and any Windows pid. Give every acquire in these tests that could hang an `AbortSignal.timeout(...)`.\n   In `packages/hench/tests/e2e/validation-slot-crash.test.ts`, the Windows branch (around lines 107–116):\n   - give the acquire an `AbortSignal.timeout(30_000)`;\n   - do not assert `isAlive(recorded.pid)` false on a freed pid. Assert instead that the lease was taken and the record now names the second holder.\n2. [P3] `packages/hench/tests/integration/test-gate.test.ts` around line 299 (\"starts the gate's timeout after admission\"): it holds the slot for 1 s and gives the probe an 800 ms timeout, which is tight on loaded Windows or macOS runners. Hold the slot for 3 s and use a 2.5 s timeout; the test means the same thing. Adjust the `queueMs` threshold to match.\n3. [P3] `docs/packages/hench.md` around line 162 says \"API-provider runs stop waiting only when the process exits\". Commit e89907f6c wired `abortSignal` through the API loop, so Ctrl-C stops those waits too. Correct the sentence after checking the API loop code, and fix the same claim wherever else it appears (grep docs/ and TESTING.md).\n\nOperator notes: run the changed test files and the static root policy tests. No changeset (tests and docs only). No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "Slot tests use 2 ** 30 as the dead pid and every acquire that could hang has an abort timeout; the crash test's Windows branch no longer checks a freed pid"
  - "The admission-timeout test uses a 3 s hold and a 2.5 s timeout"
  - "No doc says API-provider runs ignore Ctrl-C while waiting for the slot"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "review-fix"
  - "windows"
source: "ndx-capture"
---
