---
id: "9d453c6d-7937-499b-9b4b-7df661a0ef09"
type: "change"
title: "A test-gate failure tells the next attempt what failed"
slug: "a-test-gate-failure-tells-the-next"
intent: "When the full test gate fails a hench run, the task's failureReason is set to a short digest of the failing tests (names plus the first assertion or error line, else the last lines of gate output), capped and redacted, so the brief's 'Previous attempt failed' section carries it to the retry. Failing tests that the run itself added or changed get a hint that the test may be wrong. Works for every vendor. Seen on a local-model loop where each retry started blind and kept changing code to satisfy a broken new test."
acceptanceCriteria:
  - "A gate-failed run leaves a failureReason on the task naming the failing tests and their first error line, capped in size and with secrets redacted"
  - "With no recognisable failure lines the reason falls back to the last lines of the gate output"
  - "A failing test in a file the run added or changed carries a hint to fix the test rather than the code when it fails while setting up"
  - "The next run's brief shows the reason under 'Previous attempt failed', and a later successful run clears it"
touches:
  - "dde6d1c4-a1bd-4dfe-9af8-0ec057addf16"
source: "ndx-capture"
---
