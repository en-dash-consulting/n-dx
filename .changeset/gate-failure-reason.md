---
"@n-dx/hench": patch
---

A test-gate failure now tells the next attempt what failed. When the full test
gate fails a run, hench records a short `failureReason` on the task: the
failing tests (vitest, jest and node:test output) with the first assertion or
error line of each, or the last 20 lines of gate output when none can be read,
capped and redacted like the run log. A failing test in a file the run itself
added or changed carries a hint that the test may be wrong and should be fixed
rather than the code. The next brief shows it under "Previous attempt failed",
and a run that completes the task clears it. Works for every vendor.
