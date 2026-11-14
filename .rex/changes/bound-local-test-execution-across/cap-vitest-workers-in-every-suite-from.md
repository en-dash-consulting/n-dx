---
id: "d34d2902-408a-4b05-9de9-7b2932aae778"
type: "task"
title: "Cap vitest workers in every suite from one shared setting"
slug: "cap-vitest-workers-in-every-suite-from"
description: "PR 1 of 3 (worker cap), task 1 of 3.\n\nNo vitest config in the repository sets `maxWorkers`, so each suite takes every core. Add one shared helper that reads `NDX_TEST_MAX_WORKERS` and returns the cap (a positive integer) or undefined when the variable is unset, empty or invalid, and use it as `test.maxWorkers` in the root `vitest.config.js` and every `packages/*/vitest.config.ts`. Leave `packages/rex/vitest.bench.config.ts` alone (it already runs one file at a time). Unset must keep vitest's own default, so a solo run behaves exactly as today.\n\nWhere the helper lives: repository test tooling, beside the shared setup files under `tests/` (for example `tests/test-max-workers.js`), imported by relative path from each config the same way the configs already reference `../../tests/setup-*.js`. It is not package source and must not be exported from any package. Give the helper an `env` parameter defaulting to `process.env` so tests can pass an object.\n\nCheck the configs that run projects or multiple pools (web, sourcevision, root) so the cap applies to every project, not only the top level. An invalid value (0, negative, non-numeric) is ignored with a one-line warning rather than failing the run.\n\nOperator notes:\n- Tests must not write `process.env.NDX_*` or call `vi.stubEnv(\"NDX_…\")` (tests/e2e/color-env-neutralized policy): pass an env object to the helper instead.\n- Run the static root policy tests before finishing: architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy, credential-isolation-setup-policy (all under tests/e2e/).\n- The sandbox allows only npm, npx, node, git, tsc, vitest."
acceptanceCriteria:
  - "Every vitest config except the rex bench config sets maxWorkers from the shared helper"
  - "With NDX_TEST_MAX_WORKERS unset, empty or invalid the helper returns undefined and vitest keeps its default"
  - "With NDX_TEST_MAX_WORKERS=2 a suite run uses at most two workers, including configs that define multiple projects"
  - "The helper has unit tests that pass an env object rather than writing process.env"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
source: "ndx-capture"
---
