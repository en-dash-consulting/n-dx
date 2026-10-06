---
id: "e3c0e72f-ea10-47bf-83a0-0c58cb97c198"
level: "task"
title: "affected mode skips the 2-second root policy tests when a change stays inside one package's src or tests"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "test-gate"
  - "scripts"
  - "539"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "selectAffected selects a root-policy suite for any change under packages/<dir>/src/ or packages/<dir>/tests/ when full root is not selected, and never selects both; unit tests cover a hench test-only change, a hench src change and a web src change."
  - "`node scripts/run-all-tests.mjs root-policy` runs exactly the six static root policy test files and reports under the root-policy label in the selected-suites and failed-suites lines."
  - "A unit test fails if any file in the root-policy list does not exist on disk."
  - "TESTING.md documents the root-policy suite and when affected mode selects it."
description: "Verdict: must-fix (medium). This PR opts the repo into `affected` mode through `.n-dx.json`, so the gap goes live when it merges.\n\n**Failure scenario.** Measured with the real `selectAffected` against this repo's manifests:\n- a new hench test file importing `tools/test-runner` (`packages/hench/tests/unit/tools/new.test.ts`) selects `hench` only;\n- a hench source file that adds a `node:child_process` import (`packages/hench/src/agent/lifecycle/foo.ts`) selects `hench` only;\n- `packages/web/src/server/routes-hench.ts` selects `web` only.\n\nIn none of these does root run. So the static root policy tests that police package sources and tests never run in the local gate:\n- `tests/e2e/architecture-policy.test.js`\n- `tests/e2e/domain-isolation.test.js`\n- `tests/e2e/shell-spawn-inventory-policy.test.js`\n- `tests/e2e/wall-clock-inventory-policy.test.js`\n- `tests/e2e/layout-literal-policy.test.js`\n- `tests/e2e/obfuscated-code-policy.test.js`\n\nThe gate passes, hench completes the task, and only CI fails, after the run, with no hench run record for the fix. Agents skipped exactly these tests twice on this branch (task 1: child_process; task 3: shell-spawn inventory), and the gate caught both. All six together take about 2 s (measured 1.86 s).\n\nEvidence: `scripts/lib/select-suites.mjs:150-164`. A package `tests/` change marks only that package. A package `src/` change marks the package and its dependents, and root only for `src/cli/`. 21 files under `tests/e2e/` read package sources directly.\n\n**Reachable:** every gate under `hench.testGate.command = \"node scripts/run-all-tests.mjs affected {base}\"` (this repo after the PR) whose change stays inside a package's `src/` (outside `src/cli/`) or `tests/`. **Covered:** only by CI.\n\n**Options.**\n- **(a) Recommended.** Add a `root-policy` suite: the six files above, run with the root vitest config (`node_modules/.bin/vitest run <six files>`, or through `scripts/run-vitest-bind-aware.mjs` if root needs it). `selectAffected` selects it whenever a file under `packages/<dir>/src/` or `packages/<dir>/tests/` changed and full `root` is not selected. Full root implies it, so never run both. It gets its own label (`root-policy`), so `{suites}` re-runs and `test-gate: failed-suites=` work unchanged. Keep the file list in one exported constant, and add a unit test that fails if any listed file is missing from disk. Cost: about 30 lines plus tests. Risk: none to the savings.\n- **(b)** Select full root for any package source change. Simpler, but it adds 2.5–6 min to most gates and undoes much of #539 item 3.\n- **(c)** Accept CI as the catch (the issue's original rule).\n\nAlso update `TESTING.md`'s \"Running a subset of suites\" rules and `resolveLabels`, so `root-policy` is a valid label and is in the `--list` output.\n\n**Validation.**\n- `node_modules/.bin/vitest run tests/unit/select-suites.test.js tests/integration/run-all-tests-selection.test.js` and the six policy tests.\n- `node scripts/run-all-tests.mjs root-policy` runs and passes.\n- Do not run the full suite."
lastModified: "2026-10-06T22:01:20.060Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
