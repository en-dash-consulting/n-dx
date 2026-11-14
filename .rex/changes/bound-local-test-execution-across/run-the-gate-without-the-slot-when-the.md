---
id: "f2aa9f8c-556b-453f-bc9d-7fa9af4fa7a2"
type: "task"
title: "Run the gate without the slot when the slot cannot be taken"
slug: "run-the-gate-without-the-slot-when-the"
summary: "If the shared validation slot cannot be used, for example because the disk is full or the folder is read-only, hench currently lets the task pass without running its tests. This changes it to run the tests anyway and warn that the slot was skipped."
description: "PR 2 (#1034) review by Hal, 2026-11-14 (thread 4570835461), [P1].\n\nProblem: in `packages/hench/src/process/validation-run.ts` (around line 104), a non-abort acquire error returns `ok: false`. `runGateCommand` turns that into `{ ran: false }` with no `skipReason`. `finalizeRun` then takes the INCONCLUSIVE branch (`shared.ts` around line 4706): it prints a warning and \"The run continues\", so the work is completed and committed with no tests run.\n- This happens on EACCES, EROFS or ENOSPC under the ndx home, on an unsupported `link()` (exFAT, some FUSE or network mounts), or when `holder.json` is a directory. While the error persists, every gate on the host does it.\n- Meanwhile the completion check fails closed (`valid: false`), so the two paths disagree.\n\nFix (Hal's option a): on a non-abort acquire error, run the command without the slot and return the error as a `slotWarning`. The warning must say the slot was skipped and why, naming the slot directory. Apply this at every call site (gate attempt, re-run, post-task tests, completion check) so they agree. An abort still stops without running.\n- Update the module comment that says \"fails closed\" so it describes what happens.\n- Adjust the two existing tests that expect `ran: false` / `valid: false` on an acquire error.\n- Add tests:\n  - the gate runs and reports its real pass or fail when acquire throws EACCES (inject through a slot directory that is a file, or a fake slot API);\n  - the completion check does the same;\n  - the warning names the slot directory.\n\nOperator notes: run the changed test files plus `tests/integration/test-gate.test.ts`, `gate-only-retry` and the static root policy tests. Update docs that describe the failure behaviour (TESTING.md, docs/guide/configuration.md, docs/packages/hench.md) only where they state it. Add a patch changeset for `@n-dx/hench`. No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "A non-abort slot acquire error runs the command without the slot and returns a slotWarning naming the slot directory, at every call site (gate, re-run, post-task, completion)"
  - "Tests show the gate and the completion check report the command's real result when acquire fails; an abort still stops without running"
  - "Comments and docs no longer say the slot fails closed; a patch changeset for @n-dx/hench"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "review-fix"
source: "ndx-capture"
---
