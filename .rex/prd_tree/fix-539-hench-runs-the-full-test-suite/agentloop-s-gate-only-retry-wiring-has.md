---
id: "9665324f-6acd-40d8-bd29-5b208cc19cf0"
level: "task"
title: "agentLoop's gate-only retry wiring has no test"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "test-coverage"
  - "539"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An integration test drives agentLoop through a gate-only retry: no provider is constructed, the gate runs from the source run's startHead, the held resolution is applied and run.gateOnlyRetry is recorded."
  - "The test fails if the gate-only check is moved after provider resolution or before the task is claimed."
description: "Verdict: should-fix (low). This was first raised by the task 4 reviewer (run 5b6490d4, deferred) and confirmed in the branch review.\n\n**Gap.** `packages/hench/src/agent/lifecycle/loop.ts:1777-1818` wires `planGateOnlyRetry` / `executeGateOnlyRetry` into the API-provider `agentLoop`. The order is correct on reading:\n1. `prepareBrief` claims the task at :1739.\n2. `transitionToInProgress` runs at :1762.\n3. The baselines are captured at :1768-1771.\n4. The check runs at :1781, before provider resolution.\n\nBut no test exercises it. `tests/integration/gate-only-retry.test.ts` drives `cliLoop` only. Any of these regressions would go unnoticed:\n- moving the check after provider resolution, so it needs an API key;\n- moving it before the claim, so `recordPendingCompletion` returns false and the agent runs;\n- dropping `baselineUntracked`.\n\n**Reachable:** `ndx work --task=<id>` with `hench.provider: \"api\"` on a task whose previous run failed only at the gate. **Covered:** not by any test.\n\n**Fix (recommended).** Add one integration case that drives `agentLoop`, following the cliLoop case in `gate-only-retry.test.ts`:\n- a seeded source run that failed at the gate with a not-applied hold and reachable commits;\n- `runTestGate` mocked to pass.\n\nAssert:\n- no provider was constructed and no LLM call was made (mock the provider factory and assert it was never called);\n- the gate ran with base = the source run's startHead;\n- the held resolution was applied;\n- `run.gateOnlyRetry` was recorded.\n\nCost: one test file. Risk: none.\n\n**Validation.**\n- `pnpm --filter @n-dx/hench exec vitest run <the new test> tests/integration/gate-only-retry.test.ts`.\n- The six root policy tests. A test importing `tools/test-runner` or `lifecycle/shared` may need a row in `tests/shell-spawn-inventory.md`.\n- Do not run the full suite."
lastModified: "2026-10-06T22:01:39.251Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
