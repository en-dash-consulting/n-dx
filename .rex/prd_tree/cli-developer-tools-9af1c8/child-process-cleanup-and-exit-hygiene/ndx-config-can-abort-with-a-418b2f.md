---
id: "418b2f4a-f807-45c7-8df0-d55b9916e34a"
level: "task"
title: "ndx config can abort with a libuv UV_HANDLE_CLOSING assertion during teardown"
status: "pending"
priority: "medium"
tags:
  - "flaky-test"
  - "windows"
  - "exit-hygiene"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Reproduced deliberately — e.g. many concurrent `ndx config` spawns under CPU load — so a fix can be verified rather than assumed"
  - "Identified which handle is double-closed: the update-check timer, the signal-handler disposal, or child-tracker cleanup"
  - "The update-check race clears its 500 ms timer when the check loses, so no timer outlives the race"
  - "`ndx config <key>` exits cleanly under sustained concurrent invocation on Windows, with no libuv assertion"
  - "The fix is a teardown correction, not a test retry or a mute"
description: "Observed once, on Windows, during a full `npm run test`:\n\n    FAIL tests/e2e/cli-config.test.js > n-dx config > single positional: key vs directory\n         > resolves a known key as a key even when a directory of that name exists\n    Error: Command failed: node C:\\...\\packages\\core\\cli.js config hench\n    Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94\n\nThe important detail is where the assertion comes from. It is not vitest failing an expectation — it is the SPAWNED `cli.js` aborting. `src/win/async.c:94` is libuv asserting that an async handle is not already closing, i.e. a double-close during process teardown. So `ndx config hench`, a read-only command, can abort instead of exiting cleanly. The test is the messenger, not the defect.\n\nTeardown path is `flushAndExit` (packages/core/cli.js:384): `signalHandlers.dispose()`, then `await childTracker.cleanup()`, then an update-check `Promise.race` against a 500 ms `setTimeout` whose timer is never cleared when the check loses. Any of those three could leave or re-close a handle; the uncleared timer and the signal-handler disposal are the first places to look, and `interrupt-forwarding` is relevant because it attaches and detaches process-level listeners around child lifetime.\n\nEVIDENCE, stated precisely so nobody over-trusts it:\n- Seen exactly once, in run-all-tests.mjs at ~10:05 local, reported as 1 failed / 2153 passed / 3 skipped in that suite.\n- The whole file passes in isolation: 149/149, verified after the fact. An earlier \"passes in isolation\" check of mine used a `-t` filter that skipped 148 of 149 tests, so it proved much less than it appeared to — the full-file run is the one that counts.\n- NOT reproduced since. Note that `pnpm run validate` is `pnpm -r run validate` and therefore does not run root `tests/e2e` at all, so the later green validations are NOT evidence against this. Only a full `npm run test` exercises it.\n- Machine load is the most likely trigger: a monorepo build was running concurrently in another process when it fired, and this file spawns a `cli.js` child per test (149 spawns). `run-all-tests.mjs` itself is sequential (execFileSyncCli), so suite-level parallelism is not the variable — vitest's within-suite file parallelism plus ambient load is.\n\nWorth fixing rather than muting: a native abort during exit is the kind of failure that shows up as a mysterious non-zero exit in someone's CI or pre-commit hook, with no JavaScript stack to explain it. A test retry would hide exactly the signal that makes it findable."
lastModified: "2026-08-27T17:45:06.678Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
