---
id: "1d5360b5-e284-4327-ae21-554c2e134e97"
type: "task"
title: "Make the pre-spawn abort test hold where no sandbox runs"
slug: "make-the-pre-spawn-abort-test-hold"
summary: "A new test checks that cancelling a run while it is still preparing starts no process. On Windows there is no preparing step, so the test passes or fails by timing. This makes the test create the preparing step itself, so it means the same thing everywhere."
description: "CI on #1048 (run 43899785363, job \"Tests (Windows, hench)\", head d2929ee01) failed in a test added by PR 3's review repair for task 3ab4bb09:\n\n`packages/hench/tests/integration/session-bounds-spawn.test.ts` > \"spawnWithAdapter session bounds > an abort while the spawn is being prepared starts no process\" (around line 128):\n```\nAssertionError: promise resolved \"''\" instead of rejecting\n ❯ tests/integration/session-bounds-spawn.test.ts:137:45\n    await expect(readFile(pidFile, \"utf-8\")).rejects.toThrow();\n```\nThe same test passed on #1035's Windows run and on Linux and macOS.\n\nCause, from `spawnVendorProcess` in `packages/hench/src/agent/lifecycle/cli-loop.ts` (around lines 930–953):\n- The test calls `spawn(...)`, then calls `controller.abort(...)` synchronously, relying on the spawn awaiting its pre-spawn step first (its own comment says so).\n- That await exists only when `createVendorCliSandbox` returns a sandbox, or for a self-confined vendor session (`withSessionValidationSlotDir`, then `sandbox.prepareSpawn`).\n- On Windows no sandbox backend exists, so `sandbox` is null and nothing is awaited. `spawnVendorProcess` runs straight into the `new Promise` that spawns the child before the test's `abort()` line executes. The abort listener then kills the child, but the fake CLI may already have written the pid file, depending on timing.\n\nThe production code is correct (an abort during a real pre-spawn await starts nothing). The test's premise does not hold where no sandbox runs.\n\nFix the test, not production:\n- Make the pre-spawn step happen on every platform by injecting it, for example:\n  - pass `vendorSandbox` options whose `hostIdentity` cache resolves only after the test aborts, so `withSessionValidationSlotDir` is awaited; or\n  - add a narrow test seam on `SpawnWithAdapterOptions` (e.g. `prepareSpawn` / `beforeSpawn`) that the test resolves after aborting.\n\n  Pick the smallest change that keeps production behaviour unchanged. Make sure the abort happens while the spawn is genuinely suspended on that step, e.g. abort from inside the injected step or after a resolved promise the step awaits.\n- Keep the assertions: `result.aborted.reason`, no `timedOut`, no pid file.\n- If the existing \"an already-aborted signal starts no process\" test relies on the same premise, check it holds on Windows too.\n\nOperator notes: run `session-bounds-spawn.test.ts`, the `sandbox-pre-spawn` and `cli-loop` related tests, and the static root policy tests. No changeset unless production code changes (a test-only seam that is not exported in the package's public surface does not need one). No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "The test suspends the spawn on an injected pre-spawn step on every platform and aborts during it; it no longer depends on a sandbox existing"
  - "The test still asserts the aborted reason, no timeout and no pid file; production behaviour is unchanged"
  - "session-bounds-spawn and related tests pass locally; static root policy tests pass"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
  - "ci-fix"
  - "windows"
source: "ndx-capture"
---
