---
id: "ee944d3b-6829-4cac-901a-427b91170c79"
type: "task"
title: "Make scripts/run-all-tests.mjs take the host validation slot"
slug: "make-scripts-run-all-tests-mjs-take"
description: "PR 3 of 3 (runner takes the slot), task 1 of 2. Stacked on PR 2; needs its slot protocol.\n\nA whole-suite run started by hand (`pnpm test`, `node scripts/run-all-tests.mjs …`, an agent or reviewer running the runner) bypasses hench's slot today. Make the runner take the same slot.\n\nAdd `scripts/lib/validation-slot.mjs`, a plain-JS implementation of the on-disk protocol documented in the header of packages/hench/src/process/validation-slot.ts (scripts cannot import hench). Resolve the ndx home with `resolveNdxHome` from packages/core/layout.js, which the scripts may import (run-all-tests.mjs already imports from packages/core).\n\nIn scripts/run-all-tests.mjs:\n- acquire before the stale-package rebuild and the first suite, release after the summary, and release on SIGINT/SIGTERM after the child suites have exited;\n- if `NDX_VALIDATION_SLOT` names the live holder of the same slot directory (a hench gate that spawned this runner), run nested without acquiring;\n- `--list` runs nothing and never acquires;\n- print one line when waiting (who holds it, since when) and print the queue wait in the summary;\n- an opt-out for a deliberate parallel run, e.g. `--no-slot`, documented in the usage text.\nAlways on in this repository: the runner is repository tooling, not hench config.\n\nDrift guard: add a root test (tests/e2e/…) that starts a holder through hench's built slot module and a contender through the scripts implementation (and the reverse) against one temp ndx home, and asserts they exclude each other and that the token nesting works both ways. Register it in `ROOT_DRIFT_TEST_FILES` in scripts/lib/select-suites.mjs so a change to either implementation selects it, and keep select-suites' own unit tests passing.\n\nOperator notes:\n- Tests use a temp ndx home (tests/setup-ndx-home.js) and must not write `process.env.NDX_*`; pass env to spawned children explicitly.\n- The root suite's globalSetup (tests/e2e/verify-build.js) needs built dist; the new test reads hench's dist.\n- Spawns need `windowsHide` (windows-hide-policy) and must be in the shell-spawn inventory if that policy requires it.\n- Run the static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy, windows-hide-policy)."
acceptanceCriteria:
  - "A run-all-tests.mjs started by hand waits while a hench gate or another runner holds the slot, and reports the wait"
  - "A runner spawned by a hench gate holding the slot runs nested without deadlocking"
  - "--list never acquires the slot, and the documented opt-out runs without it"
  - "The slot is released after the summary and on SIGINT/SIGTERM once child suites have exited"
  - "A root drift test proves the hench and scripts implementations exclude each other and honour each other's token, and it is listed in ROOT_DRIFT_TEST_FILES"
priority: "high"
run: {"maxTurns":150}
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
source: "ndx-capture"
blockedBy:
  - "85839d4a-3b74-4e79-bb93-838726de17cf"
---
