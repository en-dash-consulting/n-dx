---
id: "68780628-0d67-46b9-b858-5354d9ed121a"
level: "task"
title: "Opt this repo into the scoped gate and flake re-run; document the test-gate templates; changeset"
status: "pending"
priority: "medium"
tags:
  - "docs"
  - "changeset"
  - "config"
  - "539"
blockedBy:
  - "4ecb7c25-28bb-4226-8510-36dff70193b4"
source: "ndx-capture"
acceptanceCriteria:
  - ".n-dx.json sets hench.testGate.command to `node scripts/run-all-tests.mjs affected {base}` and hench.testGate.rerunCommand to `node scripts/run-all-tests.mjs {suites}`, and hench loads both."
  - "docs/packages/hench.md documents both templates, the output-line protocol, the new run-record fields, the gate-only retry and the read-only-refusal change; TESTING.md documents the run-all-tests labels, affected mode and --list."
  - "A patch changeset with scoped package names covers every package changed on the branch and passes `pnpm changeset status`."
description: "#539 items 1–4, wrap-up. Task 7 of 7, the last before the PR. Read the earlier tasks' commits on this branch first (`git log main..HEAD`) and document what was actually built, not what the descriptions planned.\n\n**1. Opt this repo in.** In `.n-dx.json` add:\n```json\n\"hench\": {\n  \"testGate\": {\n    \"command\": \"node scripts/run-all-tests.mjs affected {base}\",\n    \"rerunCommand\": \"node scripts/run-all-tests.mjs {suites}\"\n  }\n}\n```\n- Put it in `.n-dx.json`, not `.hench/config.json`, so it travels with the repo config that `loadConfig` deep-merges.\n- Confirm it loads: a hench unit test or `ndx config hench.testGate.command` from the built CLI of this branch (`node packages/core/cli.js config hench.testGate.command .`). Keep `fullTestCommand` unset so repos without these keys are unaffected.\n- Check whether any test pins `.n-dx.json` content and update it if so.\n\n**2. Docs.**\n- `docs/packages/hench.md` \"Completion Waits for the Test Gate\" (l.82-90). Document:\n  - `hench.testGate.command` with `{base}`, and its precedence over `fullTestCommand`;\n  - `hench.testGate.rerunCommand` with `{suites}`, and when the one re-run happens (unattended only);\n  - the output-line protocol a project's runner emits for hench to read (`test-gate: selected-suites=…`, `test-gate: failed-suites=…`);\n  - the run-record fields `testGate.base`, `suites`, `scopeFallback`, `flakyRerun`, `firstAttempt`, `rerun`, and `gateOnlyRetry`;\n  - the gate-only retry: when it happens, the loop guard, and review inheritance;\n  - the read-only-refusal suppression message.\n- `TESTING.md` (~l.55): document `node scripts/run-all-tests.mjs <label,…>`, `affected <base>` with its selection rules (root and run-everything triggers), and `--list`.\n- `docs/guide/configuration.md` has no test-gate rows today. Add the two keys if the page lists hench keys elsewhere; otherwise link to hench.md.\n- If `AGENTS.md`'s generated sections or `packages/core/assistant-assets/` mention running the full suite, align them through the generator (`packages/core/assistant-assets.js`) and regenerate. Do not hand-edit generated output. Docs reach AGENTS.md, not CLAUDE.md alone.\n\n**3. Changeset.** One `.changeset/*.md`, patch bumps, SCOPED names: `@n-dx/hench`, `@n-dx/core` (config help text), and `@n-dx/web` (dashboard config field list). Add any other package the earlier commits touched. Summarise the four behaviours in user terms and reference #539.\n\n**Validation.**\n- `node_modules/.bin/vitest run tests/e2e/hench-config-gate-contract.test.js` plus any doc or policy test you touch (for example `tests/e2e/assistant-body-drift.test.js` if generated docs changed).\n- `pnpm changeset status` must accept the changeset.\n- Do not run the full suite."
lastModified: "2026-10-06T17:13:34.331Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
