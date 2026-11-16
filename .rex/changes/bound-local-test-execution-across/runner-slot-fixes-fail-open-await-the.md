---
id: "5bd00ff5-6790-498b-be8c-123681df0b4b"
type: "task"
title: "Runner slot fixes: fail open, await the child record, skip empty selections"
slug: "runner-slot-fixes-fail-open-await-the"
summary: "Small fixes to how the test runner uses the shared slot. It runs the tests even if the slot is broken, it never brings back a slot record after giving it up, and it does not queue when there is nothing to test. One flaky Windows test is also fixed."
description: "PR 3 (#1035) review by Hal, 2026-11-14 (threads 4570848005 and 4570847997, plus a design question in the review body), plus consistency with PR 2's fail-open change (f2aa9f8c).\n\n1. **Fail open.** `scripts/run-all-tests.mjs` (`takeSlot`, around line 289) on a non-abort acquire error should behave like hench now does: print a warning naming the slot directory and the error, then run the suites without the slot. Today it exits or fails. An abort (Ctrl-C) still stops. Update the run summary line (\"Validation slot: …\") so it says the slot was skipped and why.\n2. **[P3] Await the child record** (around line 125): `slot?.recordChild(child.pid)` is fired and not awaited. If its rename lands after release's unlink, it recreates `holder.json` or overwrites the next holder's record. Keep the last `recordChild` promise, chain later ones, and await it in `finish()` before release, as hench's `runInValidationSlot` does.\n3. **Skip the slot when nothing is selected** (design question): an `affected` run that selects no suites and needs no stale rebuild should not queue for the slot (`run-all-tests.mjs` around line 363). Skip `takeSlot` when `labels.length === 0` and nothing needs rebuilding. The existing \"waits while another process holds the slot\" test in `tests/integration/run-all-tests-selection.test.js` relies on the empty selection, so switch it to a real but tiny suite selection (or a fixture) that still exercises waiting. Add a test that an empty selection does not wait behind a holder.\n4. **[P2] Windows pid reuse in the parity test** (`tests/e2e/validation-slot-parity.test.js` around line 293): the test outside the `skipIf(win32)` block treats a just-killed child's pid as dead, and Windows reuses freed pids quickly. Skip that case on win32 with a comment (the POSIX run covers the logic), or loop until the pid reads dead and retry with a new holder if it was reused. Prefer the skip.\n\nOperator notes: run `tests/integration/run-all-tests-selection.test.js`, the parity test (build hench first) and the static root policy tests. Update TESTING.md's runner-slot paragraph for the fail-open and empty-selection behaviour. No changeset (repository tooling). No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "The runner runs the suites without the slot, with a warning, on a non-abort acquire error; an abort still stops"
  - "finish() awaits the last recordChild before releasing; an affected run with nothing selected and nothing to rebuild does not take or wait for the slot, with a test"
  - "The parity test's just-killed-pid case is skipped on win32; TESTING.md describes the runner's fail-open and empty-selection behaviour"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
  - "review-fix"
source: "ndx-capture"
---
