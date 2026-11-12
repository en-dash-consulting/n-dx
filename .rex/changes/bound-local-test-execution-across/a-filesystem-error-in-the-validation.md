---
id: "823880dc-c2ca-4221-8fae-5a413a0eed80"
type: "task"
title: "A filesystem error in the validation slot escapes the test gate, which promises never to throw"
slug: "a-filesystem-error-in-the-validation"
summary: "When the shared lock folder cannot be written, the end-of-task test check crashes instead of reporting that it could not run. Reporting it keeps the run's record intact."
description: "Verdict: should-fix (adversarial review of adb92a12, run d47c99c0). Severity medium.\n\nScenario: hench.testGate.hostSlot is on and the slot directory under the ndx home cannot be created or written (read-only NDX_HOME, EACCES, ENOSPC). `acquireValidationSlot` throws a non-abort error; `runInValidationSlot` (packages/hench/src/process/validation-run.ts) rethrows anything that is not a ValidationSlotAbortedError, so `runTestGate` / `runPostTaskTests` / `validateCompletion` throw. `runTestGate` documents \"Never throws\" and finalizeRun's call site (agent/lifecycle/shared.ts, the runTestGate loop) has no try/catch, so finalizeRun rejects after the agent's work is done. The same holds for `lease.release()` failing inside the `finally`, which also replaces the command's result with the release error.\n\nReachability: only with hostSlot on and an unwritable ndx home; rare, but the consequence is a crashed finalize rather than a reported gate outcome.\n\nOptions:\n- (A, recommended) In runInValidationSlot, turn an acquire failure into `{ ok: false, error: \"could not take the validation slot: <message>\" }` (fails closed: the gate reports ran:false with the error, completion validation is invalid), and make a release failure a warning carried on the outcome rather than a throw. Cost: ~15 lines and two tests. Risk: low; the result is still reported, not swallowed.\n- (B) Wrap the slot calls at each of the three call sites. More code, same effect."
acceptanceCriteria:
  - "With hostSlot on and a slot directory that cannot be created, runTestGate resolves (ran: false, error naming the slot) instead of rejecting; a test in packages/hench/tests/integration/test-gate.test.ts covers it"
  - "A release failure after the command ran does not replace the command's result with a thrown error"
  - "validateCompletion and runPostTaskTests report the same failure without throwing"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
  - "pr-2-host-slot"
source: "ndx-adversarial-review"
---
