---
id: "12f0e072-26b1-4627-bb5a-65c4a0670dc8"
level: "task"
title: "A rex test worker exits mid-run under pnpm validate concurrency, failing the suite with every test passing"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "flaky-test"
  - "ci-reliability"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The crash is reproduced from a real run and the exiting worker's cause is identified — an uncaught exception, an OOM, or a process another suite killed — rather than inferred from the exit code"
  - "pnpm validate completes with 0 errors across at least 10 consecutive runs on Windows"
  - "If the cause is a test leaking a kill or exhausting memory, the fix isolates that test rather than retrying the worker"
  - "If vitest's own worker supervision is the cause, the finding is recorded in TESTING.md Family 3 with the version it was observed on"
description: "Found by the adversarial review of the Group A test-reliability branch (test/wall-time-tail), 2026-10-14. Verdict: out-of-scope for that change — pre-existing as far as the evidence goes, and reported rather than attached to it.\n\n**Failure.** pnpm validate (every package's 'tsc --noEmit && vitest run', run concurrently) ended with: 'Worker exited unexpectedly with exit code 1 during started state while running test file packages/rex/tests/integration/smart-add-vendor-model-selection.test.ts'. Test Files 335 passed (336); Tests 6712 passed, 20 skipped; Errors 1. Every test that ran passed. The suite still failed, because a worker died while a file was in its started state, so that file produced no result at all. An exit code with no failing assertion gives nothing to debug from.\n\n**Reachability.** pnpm validate is the repo's own validation target, named in package.json and run before a push. Not synthetic.\n\n**What is already known.** The file passes standalone (5 tests), and rex's full suite passed 336/336 on a re-run immediately after. So it is load- or concurrency-sensitive and did not reproduce in 2 of 3 attempts. pnpm validate runs all packages at once, a heavier load than the affected gate (which passed 8/8, 5676 tests) — the most likely reason it shows there and nowhere else.\n\n**Prior art, and why this is not that item.** d3a995ca ('@n-dx/rex fails intermittently under pnpm test but passes standalone') tracked the same class and was completed 2026-09-11 against two root causes: file-lock TOCTOU holes and the stale-save guard firing on same-writer promotions. Both produced failing assertions. This is a different signature — the worker process itself exits — so it is filed separately rather than reopening a resolved item. If the investigation finds a shared cause, merge the two.\n\n**Options.** (a) Reproduce first, under the real load: run pnpm validate in a loop and capture the worker's stderr — vitest reports the exit code but not what the process printed before dying. --repeats on the single file will not reproduce it; the concurrency is the trigger. Cost: machine time. Risk: may take many runs. Recommended — nothing below can be chosen without knowing whether this is an exception, an OOM, or an external kill. (b) Suspect memory: eight suites at once on a 32 GB machine with ~18 GB free; a worker hitting the heap ceiling exits non-zero with no assertion. Check --logHeapUsage on rex. (c) Suspect a cross-suite kill: this repo has history — killPortOccupant SIGKILLing a process holding a port (fixed), and the ci-child-cleanup tests killing process trees. A test killing by name or port could take a vitest worker with it. (d) Do nothing and raise the retry count: rejected, it converts a real crash into a slower green run and loses the signal.\n\nSeverity: medium — the suite fails, so it blocks a push, and the failure names a file that has nothing wrong with it."
lastModified: "2026-10-14T15:27:31.708Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
