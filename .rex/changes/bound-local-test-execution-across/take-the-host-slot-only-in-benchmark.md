---
id: "f24532f0-6032-46dd-b167-e684c54e0a5d"
type: "task"
title: "Take the host slot only in benchmark case D"
slug: "take-the-host-slot-only-in-benchmark"
description: "PR 4 (validation benchmark) bug found in the first real run, 2026-11-12.\n\nProblem: `measuredRun` in scripts/bench/validation-bench.mjs takes the host slot whenever `slotApi` is loaded (`if (slotApi)`, around line 322), and `slotApi` is loaded once for the whole benchmark whenever any selected case needs it (D is in the defaults). So cases A, B and C also queued on the host slot. Case C's three \"parallel\" runs ran one after another: each run's queue time equals the previous run's duration (hench fixture: queued 0 / 125 / 249 s; llm-client: 0 / 405 / 749 s), and its records still say `slot: false`. C therefore measured nothing about uncontrolled parallel validation, and the D-vs-C comparison is meaningless. The unit tests did not catch it because they never assert which cases acquire.\n\nFix:\n- Acquire the slot only when the batch's case has `slot: true` (case D). Cases A–C must never call `acquireValidationSlot`, and still pass `--no-slot` to the runner.\n- Record per run whether the slot was actually taken (`slotTaken`), separate from the case's configured `slot`, and make the summary refuse to report queue time for a case whose runs did not take the slot.\n- Add a unit test that drives the batch logic with a fake slot API and asserts A, B and C never acquire while D acquires once per run, and that C's runs start together (their start times are within a small window of each other).\n- In the dry-run output, state per case whether the slot is taken.\n\nAlso from the same run: the refusal check only looks at processes when the benchmark starts. Document in TESTING.md and the usage text that the operator must keep the machine idle for the whole run and that the benchmark does not stop if another run starts later; print that warning at start. (Do not add a mid-run abort.)\n\nOperator notes: no real benchmark runs in an agent session (commands time out); test with fakes and `--dry-run`. No `process.env.NDX_*` writes in tests. Run the static root policy tests before finishing."
acceptanceCriteria:
  - "Cases A, B and C never acquire the host slot; case D acquires once per run; a unit test with a fake slot API asserts both and that C's runs start together"
  - "Run records carry slotTaken, and the summary reports queue time only for runs that took the slot"
  - "--dry-run states per case whether the slot is taken"
  - "TESTING.md and the start-of-run output say the machine must stay idle for the whole run"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-4-benchmark"
  - "review-fix"
source: "ndx-capture"
blockedBy:
  - "92b189a1-8d77-463f-b524-a29b015eb6f9"
---
