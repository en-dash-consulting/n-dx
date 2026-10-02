---
id: "31277d38-de55-4c1b-9d24-729d6806ca6a"
level: "task"
title: "workspace-slot-dispatch test fails in the full web suite unless NDX_CLI_PATH is set, so CI would fail"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "tests"
  - "test-determinism"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The full web suite passes with NDX_CLI_PATH and N_DX_CLI_PATH unset in the environment, and also with them set."
  - "workspace-slot-dispatch.test.ts sets the CLI path it needs itself and restores the environment afterwards."
description: "Verdict: must-fix (found in the final verification pass; introduced by the F23 test-quality task, commit 271533d68).\n\nScenario: packages/web/tests/integration/workspace-slot-dispatch.test.ts > \"/w/<key>/ dispatch through the real server > the ready list and the prep GET resolve to the slot's, the header's and the anchor's own directory\" fails deterministically when the whole web suite runs without NDX_CLI_PATH in the environment (as CI runs): `AssertionError: expected 'node:internal/modules/cjs/loader:1386…' to contain 'Missing .hench in …'` with `Error: Cannot find module '<tmp>/ndx-slot-dispatch-*/app/packages/core/cli.js'` — resolveNdxBin (packages/web/src/server/routes-commands.ts:243) fell through to its last rung, the project-local dogfood path. It passes alone (with or without NDX_CLI_PATH) and passes in the full suite when NDX_CLI_PATH points at a real cli.js, which is why hench's own test gate (run under ndx, which exports NDX_CLI_PATH) passed it. Reproduce from the project root: `env -u NDX_CLI_PATH -u N_DX_CLI_PATH node scripts/run-vitest-bind-aware.mjs` run with `--root`-equivalent cwd packages/web — or run `env -u NDX_CLI_PATH -u N_DX_CLI_PATH npm run test --prefix packages/web`. Another test file in the suite likely changes how the require.resolve('@n-dx/core/cli.js') rung or process.env behaves; several web tests touch NDX_CLI_PATH (routes-commands, routes-hench-execute-binary-resolution, routes-hench-workspaces, config-endpoint, routes-status, routes-hench-execute-tree-conformance).\n\nFix (recommended): make the test deterministic — set NDX_CLI_PATH (and clear N_DX_CLI_PATH) to the repository's own packages/core/cli.js for the server it starts, restoring both afterwards, instead of depending on the ambient environment or on which rung the module graph happens to resolve. If a sibling test leaks an env change, fix that leak too.\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `env` is not pre-approved either, so to clear the variables use `npm run test --prefix packages/web` after unsetting them inside the test, or `npx vitest run --root packages/web <paths>`; typecheck with `npx tsc -p packages/web/tsconfig.json --noEmit` and `npx tsc -p packages/web/tsconfig.test.json --noEmit`; root policy tests with `npx vitest run tests/e2e tests/integration`. Add a patch changeset only if you change shipped code (a test-only fix needs none)."
lastModified: "2026-10-02T12:55:50.760Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
