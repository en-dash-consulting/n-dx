---
id: "d0c26ff0-add0-469e-a436-866f8319e3be"
level: "epic"
title: "Fix · #539 hench runs the full test suite three-plus times per run"
status: "pending"
priority: "high"
tags:
  - "fix"
  - "hench"
  - "test-gate"
  - "performance"
source: "ndx-capture"
startedAt: "2026-10-06T20:05:50.474Z"
endedAt: "2026-10-06T23:13:06.775Z"
acceptanceCriteria:
  - "Retrying a run that failed only at the gate, with its work committed, runs no agent session and no cold re-spawn and takes about the gate's time (#539 item 1)."
  - "One flaky suite no longer fails an autonomous run when hench.testGate.rerunCommand is set; the re-run is recorded on the run as testGate.flakyRerun (#539 item 2)."
  - "With hench.testGate.command = \"node scripts/run-all-tests.mjs affected {base}\", the gate runs only the affected suites and records them as testGate.suites (#539 item 3)."
  - "The agent brief and the in-hench review brief tell the agent to run scoped checks rather than the full suite, and a prompt test pins that guidance (#539 item 4)."
  - "A repo without the new config keys behaves exactly as before."
description: "Fixes items 1–4 of en-dash-consulting/n-dx#539. Items 5–7 (gate receipt, one gate per machine, incremental builds) are follow-ups and out of scope.\n\nProblem: an `ndx work` run spends most of its wall-clock in the full monorepo suite (~9 min quiet, ~14 min loaded), run by the agent, by the reviewer, and by hench's gate. A single flaky test fails the whole run, and a retry of committed work repeats everything (a new agent session, a read-only refusal, a cold re-spawn, then the gate).\n\nThe four deliverables:\n1. Gate-only retry: when the task's previous run failed only at the test gate with its work committed and its completion held, the next `ndx work --task=<id>` skips the agent, runs the gate, and applies the held resolution on green. Separately, `isReadOnlyRefusal` stops firing when the task's earlier attempts already committed its files.\n2. Flake absorption: in autonomous mode a failed gate re-runs only the failed suites once. A pass on the re-run counts as a pass and is recorded as `testGate.flakyRerun`.\n3. Affected-suite gate: `scripts/run-all-tests.mjs affected <base>` runs only the suites the change touches. Hench passes `{base}` through `hench.testGate.command`.\n4. The agent brief and the reviewer are told to run scoped checks inside a hench run, because the gate runs after them and CI runs everything.\n\nHench stays project-agnostic: every new behaviour is opt-in through a config template (`hench.testGate.command`, `hench.testGate.rerunCommand`). A repo without the templates keeps today's behaviour exactly. This repo opts in in the last task.\n\nConventions (every task in this epic):\n- Branch: fix/539-scoped-test-gate (this worktree), from main. One PR for the whole epic.\n- hench must not import node:child_process (tests/e2e/architecture-policy.test.js). Use the exec helpers re-exported from src/prd/llm-gateway.ts via src/process/exec.ts. Cross-package imports go through the gateway modules.\n- Run scoped tests while you work: `pnpm --filter @n-dx/<pkg> exec vitest run <file>`, the package suite, and the root test files named in your task (`node_modules/.bin/vitest run tests/e2e/<file>`). hench runs the full suite as its gate after you finish, so do not run `pnpm test` or `node scripts/run-all-tests.mjs` yourself. On this repo one full pass takes 9–14 minutes.\n- Before you finish, run the root policy tests, which agents tend to skip and the gate always catches: `node_modules/.bin/vitest run tests/e2e/architecture-policy.test.js tests/e2e/domain-isolation.test.js tests/e2e/shell-spawn-inventory-policy.test.js tests/e2e/wall-clock-inventory-policy.test.js tests/e2e/layout-literal-policy.test.js tests/e2e/obfuscated-code-policy.test.js` (about 2 s). They catch `node:child_process` outside the allowed files, non-gateway cross-package imports, and a new test file that imports tools/test-runner, tools/shell, tools/git or tools/exec-shell or spawns `sh` without a row in tests/shell-spawn-inventory.md.\n- Build only the packages you changed (`pnpm --filter @n-dx/<pkg> build`). Root e2e tests spawn the built CLIs, so a stale dist fails the gate.\n- Do not prefix commands with `cd … &&`: that form is not pre-approved and stalls the run. Use `--filter` or `--root`.\n- The gate runs with NDX_CLI_PATH set. Run any env-dependent test you add with `env -u NDX_CLI_PATH` as well.\n- Patch changesets with SCOPED names (@n-dx/hench, @n-dx/core, @n-dx/web) are written once, in the last task."
lastModified: "2026-10-07T16:16:51.159Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [a docs-only change to a page a full-root test validates (README.md, docs/guide/*.md, docs/cli-ui-gap.md) selects no suite](./a-docs-only-change-to-a-page-a-full.md) | pending |
| [a new artifact read by a root-subset test but missing from VALIDATED_ARTIFACTS is not detected](./a-new-artifact-read-by-a-root-subset.md) | pending |
| [a validated test or docs artifact changed on its own selects the suite that checks it](./a-validated-test-or-docs-artifact.md) | completed |
| [Absorb gate flakes: re-run only the failed suites once before failing an unattended run](./absorb-gate-flakes-re-run-only-the.md) | completed |
| [affected mode never runs run-options-contract, catalog-runtime-contract or prd-slug-conformance for the package-source change they police](./affected-mode-never-runs-run-options.md) | pending |
| [affected mode runs the root drift tests when a package source changes](./affected-mode-runs-the-root-drift.md) | completed |
| [affected mode skips the 2-second root policy tests when a change stays inside one package's src or tests](./affected-mode-skips-the-2-second-root.md) | completed |
| [agent brief stops forbidding the full suite when the test gate is skipped](./agent-brief-stops-forbidding-the-full.md) | completed |
| [agentLoop's gate-only retry wiring has no test](./agentloop-s-gate-only-retry-wiring-has.md) | completed |
| [Gate-only retry: skip the agent when the previous run failed only at the gate with its work committed](./gate-only-retry-skip-the-agent-when.md) | completed |
| [hench.testGate.command: a gate command template with {base}, recording the suites it selected](./hench-testgate-command-a-gate-command.md) | completed |
| [isReadOnlyRefusal returns false when earlier attempts already committed the task's files](./isreadonlyrefusal-returns-false-when.md) | completed |
| [Opt this repo into the scoped gate and flake re-run; document the test-gate templates; changeset](./opt-this-repo-into-the-scoped-gate-and.md) | completed |
| [Read-only refusal is suppressed by other tasks' commits to files an earlier attempt only edited](./read-only-refusal-is-suppressed-by.md) | completed |
| [.rex/workflow.md: a pre-existing failure introduced on this branch is fixed here; one already on main becomes its own task](./rex-workflow-md-a-pre-existing-failure.md) | completed |
| [run-all-tests.mjs comment reads "gives to give us" after the execFileSyncCli change](./run-all-tests-mjs-comment-reads-gives.md) | completed |
| [run-all-tests.mjs runs git through win-spawn's execFileSyncCli, not node:child_process](./run-all-tests-mjs-runs-git-through-win.md) | completed |
| [run-all-tests.mjs selects suites by label and by affected change since a base ref](./run-all-tests-mjs-selects-suites-by.md) | completed |
| [Task 3 follow-ups: shell-spawn inventory row, and keep the gate's suite selection after a flaky pass](./task-3-follow-ups-shell-spawn.md) | completed |
| [Tell the agent and the in-hench reviewer to run scoped checks; the gate and CI run the rest](./tell-the-agent-and-the-in-hench.md) | completed |
| [The interactive test-gate prompt never appears: require() in an ESM module aborts it silently](./the-interactive-test-gate-prompt-never.md) | completed |
