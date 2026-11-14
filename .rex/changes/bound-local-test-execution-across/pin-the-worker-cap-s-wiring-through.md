---
id: "4cabcef6-50cd-46b6-b78a-334e047774cb"
type: "task"
title: "Pin the worker cap's wiring through finalizeRun and the vendor CLI session"
slug: "pin-the-worker-cap-s-wiring-through"
summary: "Nothing currently fails if the code that passes the test worker cap into hench's own gate is deleted, because the tests only exercise the lower-level functions. Adding end-to-end checks keeps the feature from silently breaking."
description: "PR 1 (#1030) review by Hal, 2026-11-14 (thread 4570829833), [P2]. `packages/hench/tests/integration/test-worker-cap.test.ts` claims the cap reaches every test command hench runs. But it calls the leaf functions directly with `testMaxWorkers: CAP` (`runTestGate`, `runPostTaskTests`, `validateCompletion`, `createCommandExecutor`). Several wiring sites are untested, and deleting any of them leaves the hench suite green:\n- the gate wiring in `packages/hench/src/agent/lifecycle/shared.ts` (around line 4523);\n- the post-task wiring (around line 4902);\n- the vendor CLI `cliEnv` in `cli-loop.ts`.\n\nFix:\n- Add a case to `packages/hench/tests/integration/test-gate-flaky-rerun.test.ts`, which already drives the real `finalizeRun` through `configWith(...)`. Use `testGate: { command: <a node probe that exits 0 only when process.env.NDX_TEST_MAX_WORKERS === \"3\">, maxWorkers: 3 }` and assert that both the gate and the post-task tests passed. Also add one case without `maxWorkers` asserting the probe sees no variable, or an inherited one only.\n- For the CLI path, extract the `cliEnv` construction in `cli-loop.ts` into a small exported helper with no behaviour change. Unit-test that it carries `NDX_TEST_MAX_WORKERS` when the config sets `maxWorkers`, and omits it when unset.\n- Point the claim in `test-worker-cap.test.ts`'s header at the new cases so the claim matches the coverage.\n\nOperator notes: run the changed test files and the static root policy tests. The probe must work on Windows: run it with `node` and avoid shell syntax. No `process.env.NDX_*` writes in tests. No changeset unless production code changes; the `cliEnv` extraction is a refactor, so add a patch changeset for `@n-dx/hench` only if behaviour changes."
acceptanceCriteria:
  - "A finalizeRun-level test fails if the gate or post-task wiring stops passing hench.testGate.maxWorkers"
  - "An exported helper builds the vendor CLI env and a unit test fails if it stops carrying NDX_TEST_MAX_WORKERS"
  - "test-worker-cap.test.ts's coverage claim matches what is tested; changed tests pass"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
  - "review-fix"
source: "ndx-capture"
---
