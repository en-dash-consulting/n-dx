---
id: "61977eb2-9bdc-4f1d-9bf0-5be0fc593e0b"
type: "task"
title: "Refuse an invalid test worker cap and never raise an exported one"
slug: "refuse-an-invalid-test-worker-cap-and"
summary: "Today the configuration command accepts nonsense values for the test worker cap, which later breaks the settings file. A repository's cap also overrides a stricter limit the developer set for their own machine. This makes the command refuse bad values, and makes the lower of the two limits win."
description: "PR 1 (#1030) review by Hal, 2026-11-14 (threads 4570829824 and 4570829837).\n\n1. [P2] `ndx config hench.testGate.maxWorkers <value>` writes `0`, `-1`, `2.5` and `abc` as given. `packages/core/config.js` has no `HENCH_VALIDATORS` entry for `testGate.maxWorkers`, so `getValidator` returns null. Afterwards:\n   - `hench config` and `hench record` throw `Invalid hench config: … testGate.maxWorkers: Too small`;\n   - `ndx work` loads with `use-defaults`, warns, and drops the whole `testGate` block (including `command` and `rerunCommand`).\n\n   The docs (`docs/guide/configuration.md` around line 283) and the changeset `.changeset/hench-test-gate-max-workers.md` already say an invalid value is refused.\n\n   Fix: add `\"testGate.maxWorkers\": (v) => { if (!Number.isSafeInteger(v) || v < 1) throw … }` to `HENCH_VALIDATORS`, matching zod's `.int().positive()` in hench's schema, with a message in the style of the neighbouring validators. Check how `ndx config` parses the CLI string into a number before the validator runs, so `2` passes and `abc`, `0`, `-1` and `2.5` are refused. Add refusal cases and one acceptance case to the core config tests (find where `HENCH_VALIDATORS` is tested).\n\n2. [P3] `packages/hench/src/process/test-workers.ts` (around line 26) overwrites an inherited `NDX_TEST_MAX_WORKERS` unconditionally. A developer who exports `NDX_TEST_MAX_WORKERS=1` while the repository config sets `maxWorkers: 2` gets 2. Vitest does not clamp to the core count, so a repository value can also raise parallelism. That contradicts the module comment (lines ~11–12) saying the value can only lower the worker count, and the trust review relies on that comment.\n\n   Fix (Hal's option a): set the variable to `min(config value, a valid inherited value)`. A valid inherited value is a positive integer, parsed the same way `tests/test-max-workers.mjs` parses it. An invalid or absent inherited value leaves the config value. Unit-test the four cases: none inherited, lower inherited, higher inherited, invalid inherited. Make the module comment and TESTING.md (\"Capping Test Workers\") say the lower value wins.\n\nOperator notes: run the changed test files and the static root policy tests. Update the existing `@n-dx/hench` changeset text if needed, and add a patch changeset for `@n-dx/core` for the validator. No `process.env.NDX_*` writes in tests: pass env objects."
acceptanceCriteria:
  - "ndx config refuses 0, -1, 2.5 and abc for hench.testGate.maxWorkers and accepts 2, with core config tests covering both"
  - "Hench sets NDX_TEST_MAX_WORKERS to the lower of the config value and a valid inherited value; unit tests cover none, lower, higher and invalid inherited values"
  - "The test-workers module comment and TESTING.md say the lower value wins; changesets cover @n-dx/core and @n-dx/hench"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
  - "review-fix"
source: "ndx-capture"
---
