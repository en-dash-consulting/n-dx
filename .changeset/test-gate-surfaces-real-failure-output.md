---
"@n-dx/hench": patch
---

fix(hench): show the actual test failure instead of `0/0 package(s) failed`

The gate threw away every diagnostic for the test command it selects by default.
`parseVitestOutput` expected vitest JSON, but `autoDetectTestCommand` returns
`npm run test` whenever package.json has a `test` script — most repos, and this
one, where it runs `scripts/run-all-tests.mjs` and prints a human-readable
summary. `JSON.parse` threw, the fallback searched only stderr while that runner
writes its summary to stdout, and an empty array came back. The lifecycle
rendered it as `✗ 0/0 package(s) failed` with no output to print, so a real
failure was indistinguishable from a suite that never launched — and neither
said anything useful.

- The parser reads both streams and never returns an empty array for a run that
  produced output. When it cannot parse, it surfaces the raw output instead of
  reporting nothing.
- Failing packages are named only from lines carrying a failure marker. Scanning
  the whole output collected every package the run mentioned, which would have
  reported five passing packages as failures alongside the one that failed.
- Raw output is taken from stdout and stderr combined. Vitest puts `×` markers on
  stdout and the AssertionError block on stderr, and the existing helper takes
  `stdout || stderr` — so the operator was told which test failed but not why.
- A passing run is reported as passing with no output attached, so the package
  count is honest on the happy path too.
- Timeouts report distinctly, naming both the budget and the elapsed time and
  keeping whatever output arrived before the kill. A timeout still fails the run:
  a gate that cannot finish on freshly changed code is a reason to stop.

`TEST_GATE_TIMEOUT` raised 5m → 15m. The full suite here measures 248s idle —
83% of the old ceiling — and the gate runs while the agent's own subprocesses are
still competing for cores. It is a hang guardrail, not a latency SLA, and the
measurement is recorded next to the constant.

Verified end to end by running the real gate against a deliberately failing test:
the output now carries the test name, `AssertionError: expected 42 to be 43`, and
the source line.
