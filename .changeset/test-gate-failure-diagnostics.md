---
"@n-dx/hench": patch
---

Fix the full test suite gate reporting `Test gate failed: ` with `0/0 package(s) failed` and no cause when the gate timed out, failed to spawn, or produced output `parseVitestOutput` couldn't parse.

`run.error` now names the underlying diagnosis (e.g. a timeout and its elapsed duration) plus the command that was run, instead of a bare, sometimes-empty package list. The console line and fallback message say "no per-package results were parsed" rather than printing a misleading `0/0`. The gate's own combined stdout/stderr (last 200 lines) is now captured on `TestGateResult.outputTail`, copied to `run.diagnostics.testGateOutputTail`, and appended to the run log — so a hung or unparseable gate can be diagnosed after the fact instead of only reproduced by hand.
