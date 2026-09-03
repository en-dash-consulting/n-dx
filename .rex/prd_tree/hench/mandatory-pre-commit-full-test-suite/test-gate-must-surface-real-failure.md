---
id: "22477541-6076-4eac-bbab-0e8876fb7514"
level: "task"
title: "Test gate must surface real failure output when the runner is not vitest --reporter=json"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "test-gate"
  - "diagnostics"
blockedBy:
  - "02351b92-4b60-43cf-b1bc-317ea895e39f"
source: "ndx-capture"
acceptanceCriteria:
  - "A failing test run whose output cannot be parsed still surfaces raw stdout/stderr (truncated) to the operator rather than rendering as `0/0` with a blank reason"
  - "`parseVitestOutput` searches stdout as well as stderr for failure text when JSON parsing fails, instead of returning an empty array"
  - "The gate never reports `0/0 package(s) failed` — a zero-package result is either a parse failure (reported as such, with raw output) or a genuine skip"
  - "Auto-detect and the gate parser agree on a contract: either auto-detect emits a machine-readable reporter flag, or the gate explicitly tolerates human-readable runner output"
  - "Running `ndx work` on this repo with a deliberately failing test shows the failing test's name and assertion message in the gate output"
  - "`TEST_GATE_TIMEOUT` is re-evaluated against the measured 248s full-suite duration and either raised with a stated rationale or left with a comment recording the measurement"
  - "A timeout is reported distinctly from a test failure and from a never-launched suite"
description: "The gate discards all diagnostic information for this project's own test command, so a genuine failure is rendered identically to an infrastructure failure: `✗ 0/0 package(s) failed` with an empty reason.\n\nMechanism. `parseVitestOutput` (test-runner.ts:477) expects vitest JSON on stdout — the gate's own default command is `pnpm test --reporter=json`. But `autoDetectTestCommand` (test-command-resolver.ts:129) returns `npm run test`, which in this repo runs `node scripts/run-all-tests.mjs` and emits human-readable text. `JSON.parse` throws, the parser falls through to its stderr branch, the failure text is on stdout rather than stderr, and it returns `[]`. `packages.length === 0` renders as `0/0`, and `shared.ts:2048` finds no `failureOutput` to print.\n\nVerified by running the gate's exact command: `npm run test` exits 1 in 248s with `5/6 suites passed — failed: @n-dx/rex` and a full assertion message on stdout. None of that reaches the operator.\n\nTwo things collide here: auto-detect and the parser disagree about the contract, and the parser treats \"I could not parse this\" as \"there is nothing to report\". The second is the more serious — an unparseable failing run must still show the operator raw output.\n\nTimeout headroom is in scope here rather than tracked separately: the measured 248s runs against `TEST_GATE_TIMEOUT = 300_000` (test-runner.ts:439), and under the CPU load of an agent run that margin disappears. Raising it blind is the wrong fix — the right value is only knowable once failures are legible."
lastModified: "2026-09-03T19:45:55.674Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
