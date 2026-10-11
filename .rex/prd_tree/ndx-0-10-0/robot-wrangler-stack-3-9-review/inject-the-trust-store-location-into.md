---
id: "2541cd58-4786-4fc5-b656-44b3b75319cd"
level: "task"
title: "Inject the trust store location into loadVendorCliEnv so the reviewer-path tests stop setting NDX_HOME on the shared test env"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-3"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack) — follow-up to run f0c092c8 / 33f281fb, whose gate failed on color-env-neutralized.test.js"
acceptanceCriteria:
  - "`tests/unit/color-env-neutralized.test.js` passes, and no `.test.js` file contains a `vi.stubEnv(\"NDX_…\")` call added by 4d9c83ff7."
  - "`vendor-cli-env-trust.test.js` and the new `pair-programming.test.js` cases set no `process.env.NDX_*` value; they pass the trust store location through `loadVendorCliEnv`'s `trust` option."
  - "The untrusted, trusted, and `.n-dx.local.json` `cli_path` cases are still covered and pass."
  - "Production callers of `loadVendorCliEnv` are unchanged apart from the new optional argument."
  - "`pnpm --filter @n-dx/core test` and the root affected test gate pass."
description: "Run f0c092c8 (task 33f281fb) committed its fix as 4d9c83ff7, but its test gate failed on `tests/unit/color-env-neutralized.test.js`. That guard forbids `vi.stubEnv(\"NDX_…\")` in `.test.js` files: `vi.stubEnv` mutates the vitest worker's real `process.env`, and e2e siblings in the same worker spawn CLIs with `{ ...process.env }`, so a stub leaks into unrelated runs while the test is open.\n\nThe commit introduced two such mutations, both because the repository-trust store lives under `NDX_HOME`:\n- `tests/integration/pair-programming.test.js` calls `vi.stubEnv(\"NDX_HOME\", join(tmpDir, \"ndx-home\"))`, which is what the guard catches.\n- `tests/integration/vendor-cli-env-trust.test.js` assigns `process.env.NDX_HOME` directly. The guard's pattern misses it, but it is the same hazard.\n\nFix by injection, not by env:\n- Give `loadVendorCliEnv(dir, vendor, options = {})` in `packages/core/config.js` an optional `trust` option of llm-client's `RepoTrustStoreOptions` shape (for example `{ ndxHome }`).\n- Pass it through `applyRepoTrustToEnvPolicy` to `evaluateRepoTrust(dir, options)`, which already accepts it.\n- Production callers in `packages/core/pair-programming.js` keep calling without it.\n- In both tests, record trust with `recordRepoTrust(dir, { ndxHome })` and pass `{ trust: { ndxHome } }` to `loadVendorCliEnv`.\n- Remove every `vi.stubEnv(\"NDX_…\")` and every `process.env.NDX_*` assignment that 4d9c83ff7 added. If a test reaches the env through code that cannot take the option, thread the option through or restructure the test, rather than mutating `process.env`.\n\nKeep the behaviour 4d9c83ff7 implemented (repository trust applied to `guard.env.allow`; `cli_path` read from `.n-dx.local.json` first) and the cases its tests cover."
lastModified: "2026-10-11T01:32:08.371Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
