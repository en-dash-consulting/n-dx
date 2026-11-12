---
id: "31f28b1c-8b8b-4c05-9379-9366fac04223"
type: "task"
title: "A validation slot that could not be released blocks the same hench process forever on its next validation"
slug: "a-validation-slot-that-could-not-be"
summary: "If the shared test lock cannot be handed back after a test run, the same agent later waits on its own lock forever, and so does every other worktree. The lock should be recognised as abandoned."
description: "Verdict: should-fix (adversarial review of 5186679f7, run 31c44b2f). Severity medium.\n\nScenario: hostSlot on. A validation command runs; `lease.release()` then fails while `holder.json` still exists (unlink EACCES/EPERM after the slot directory's permissions change, or Windows EPERM/EBUSY from a scanner). Since 5186679f7, runInValidationSlot (packages/hench/src/process/validation-run.ts, releaseReportingFailure) turns that into a warning and returns the command's result. But the record keeps `pid: process.pid`, so isValidationSlotHolderStale (packages/hench/src/process/validation-slot.ts:269) reports it live for as long as this hench process runs. The next acquire in the same process (the gate re-run, the next gate attempt, or the next task in `--loop`) carries no NDX_VALIDATION_SLOT in process.env, so it is not nested and waits on itself until Ctrl-C; every other worktree waits too. Before 5186679f7 the throw crashed finalize, the process exited, and the record went stale.\n\nReachability: rare (release must fail with the record still on disk), but the result is a hang with no deadline rather than a reported error.\n\nOptions:\n- (A, recommended) Track this process's orphaned tokens in validation-run.ts (or validation-slot.ts): when release fails, remember the token; acquire treats a holder whose pid is process.pid and whose token is in that set (or is not owned by any live lease of this process) as stale and reclaims it. Cost: ~20 lines + one test. Risk: low.\n- (B) After a release failure, make every later runInValidationSlot in this process return ok:false (\"the validation slot could not be released earlier\") without waiting. Cost: small. Risk: gates stop running for the rest of the process.\n- (C) Retry release once before warning. Cheap, does not cover a persistent failure."
acceptanceCriteria:
  - "With hostSlot on, when release fails and holder.json remains with this process's pid, the next runTestGate in the same process does not wait on that record (it reclaims it or reports ran:false), covered by a test in packages/hench/tests/integration/test-gate.test.ts"
  - "Another process waiting on such a record is not blocked longer than the holding hench process's next validation attempt or its exit"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
  - "pr-2-host-slot"
source: "ndx-adversarial-review"
---
