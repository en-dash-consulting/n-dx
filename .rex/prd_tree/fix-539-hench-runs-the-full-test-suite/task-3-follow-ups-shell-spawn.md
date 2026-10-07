---
id: "4fe5f9a8-04e8-4df2-b2b6-1aa5d6c35c8b"
level: "task"
title: "Task 3 follow-ups: shell-spawn inventory row, and keep the gate's suite selection after a flaky pass"
status: "completed"
priority: "high"
tags:
  - "test-gate"
  - "hench"
  - "539"
  - "follow-up"
source: "ndx-capture"
startedAt: "2026-10-06T18:26:46.608Z"
completedAt: "2026-10-06T18:32:08.278Z"
endedAt: "2026-10-06T18:32:08.278Z"
resolutionType: "code-change"
resolutionDetail: "Inventory row for test-gate-first-failure.test.ts; flaky pass keeps gate's top-level testGate.suites and records firstAttempt.suites. Commit 0629cd39b."
acceptanceCriteria:
  - "tests/e2e/shell-spawn-inventory-policy.test.js passes, with test-gate-first-failure.test.ts recorded under 'Sites that need no guard' and its reason given."
  - "After a flaky pass, run.testGate.suites is still the gate's own selection, and firstAttempt / rerun carry their own suites; a test pins it."
description: "Follow-up to task 3 (4a1bdc54, commit c359128c7, run 0a504fc7). Run it before task 4. Its gate also validates task 3's code.\n\n**1. The root suite fails on task 3's new test file.**\n- Failing test: `tests/e2e/shell-spawn-inventory-policy.test.js` › \"every test file that really spawns a shell is in the inventory\".\n- Reported file: `packages/hench/tests/unit/tools/test-gate-first-failure.test.ts`.\n- Why it is flagged: the policy flags any test file that imports `src/tools/test-runner` without mocking the exec boundary.\n- Why it is safe: the test only calls `firstFailureForSuite`, which is pure and spawns nothing.\n- Fix: add a row to the \"## Sites that need no guard\" table in `tests/shell-spawn-inventory.md`, in the style of the `test-gate-failure-digest.test.ts` row (for example: \"Spawns no shell: `firstFailureForSuite` is a pure string function; nothing in the file calls `runTestGate`\"). Do not add a guard, and do not change the policy test.\n- Also check `packages/hench/tests/integration/test-gate-flaky-rerun.test.ts`. The policy did not flag it, but confirm why (it mocks the exec boundary, or it is already listed). Add a row only if one is needed.\n\n**2. Reviewer finding, deferred** (`.hench/reviews/0a504fc7-25ed-45a7-aff6-4c09f46585ae.json`, low/should-fix). After a flaky pass, `testGate.suites` holds the re-run's labels, not the gate's selection.\n- Example: the gate selects hench, rex and root; rex fails and then passes on the re-run. The pass branch spreads the re-run's result, so `run.testGate.suites` becomes `[\"rex\"]` and the log prints \"Test gate selected: rex\". `testGate.firstAttempt` has no `suites`, so the real selection is lost. That happens at `packages/hench/src/tools/test-runner.ts` ~876.\n- Fix: keep the gate's selection at top-level `testGate.suites`, which is what task 2 documents it to mean. Also add optional `suites` to `firstAttempt`, and to `rerun` on the failure branch, so each attempt's own selection is recorded. Update the `TestGateResult` types in `src/schema/v1.ts`.\n- Add an assertion to `test-gate-flaky-rerun.test.ts` that fails if the top-level `suites` becomes the re-run labels.\n\n**Out of scope:** the reviewer's ';'-chained command finding, which was dropped as not worth fixing.\n\n**Validation.**\n- `pnpm --filter @n-dx/hench exec vitest run tests/integration/test-gate-flaky-rerun.test.ts tests/unit/tools/test-gate-first-failure.test.ts tests/integration/gate-holds-completion.test.ts`.\n- The six root policy tests named in the epic conventions.\n- `pnpm --filter @n-dx/hench build`.\n- Do not run the full suite."
lastModified: "2026-10-06T18:32:08.711Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
