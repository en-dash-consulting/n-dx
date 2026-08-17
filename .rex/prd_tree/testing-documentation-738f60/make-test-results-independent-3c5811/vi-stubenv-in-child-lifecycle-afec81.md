---
id: "afec81a3-b1fe-4c5f-82b1-56af060505cc"
level: "task"
title: "vi.stubEnv in child-lifecycle.test.js leaks NDX_DEBUG_LIFECYCLE into sibling e2e children"
status: "pending"
priority: "low"
tags:
  - "testing"
  - "hygiene"
  - "determinism"
  - "core"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "No unit test mutates shared worker process.env in a way a concurrently-running sibling's spawned child can observe"
  - "The debug-enabled branch of createChildProcessTracker is still covered by a test"
  - "A full-suite run shows no [child-lifecycle] notice unless NDX_DEBUG/NDX_DEBUG_LIFECYCLE was deliberately set by the invoker"
  - "If the env-threading option is taken, isLifecycleDebugEnabled's injectable env parameter is used rather than adding a new seam"
description: "Introduced by commit 7c940821 (gating the child-lifecycle process-group notice behind NDX_DEBUG_LIFECYCLE / NDX_DEBUG). Self-reported.\n\ntests/unit/child-lifecycle.test.js calls `vi.stubEnv(\"NDX_DEBUG_LIFECYCLE\", \"1\")` to exercise the debug-enabled branch. `vi.stubEnv` mutates the real `process.env` of the vitest worker. Sibling e2e files running in that worker spawn CLI child processes with `env: { ...process.env, … }`, so a child can inherit the stub and print the notice that gating was supposed to suppress:\n\n  [child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill\n\nObserved in tests/e2e/cli-orphan-cleanup.test.js output during a full-suite run, with NDX_DEBUG absent from the invoking shell (verified) and no test other than child-lifecycle.test.js referencing the variable.\n\nImpact is genuinely low: it is one stderr line in a child process, no assertion checks for it, and scripts/cli-smoke-parity.mjs already strips that exact string as known runtime noise. Filed because the PATTERN is the problem — a unit test mutating shared worker env that process-spawning e2e siblings inherit is a pollution channel that will bite something load-bearing eventually. `vi.unstubAllEnvs()` in afterEach does not close it, because the leak window is concurrent, not sequential.\n\nOptions: (a) drop the process.env dependency for the tracker path by threading an env argument through to the debug check, so the test can pass a plain object — `isLifecycleDebugEnabled(env)` already supports this and only the no-arg tracker call site forces the stub; (b) move the debug-enabled assertion into a file configured to run in an isolated worker/pool; (c) accept and document it. Prefer (a): it removes the channel rather than scheduling around it.\n\nNote the interaction with the sibling ambient-color task — if that one introduces a central env-neutralization seam in setupFiles, it may be the natural place to also assert that no test leaves NDX_DEBUG* set."
---
