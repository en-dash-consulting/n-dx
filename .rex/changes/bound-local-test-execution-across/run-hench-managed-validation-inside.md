---
id: "adb92a12-af68-4f9a-b28b-310fb0ea9980"
type: "task"
title: "Run hench-managed validation inside the host slot and record queue time"
slug: "run-hench-managed-validation-inside"
description: "PR 2 of 3 (host-wide validation slot), task 2 of 3. Uses the slot module from the previous task.\n\nAdd `hench.testGate.hostSlot` (boolean, default false) to the config: type and validation (schema/v1.ts, schema/validate.ts), loading (store/config.ts, including the `.n-dx.json` merge) and CLI config metadata. It only tightens what runs (constraint 1bb0333a). Turn it on in this repository's `.n-dx.json`.\n\nWhen it is on, run each managed validation inside the slot:\n- each gate attempt in finalizeRun (agent/lifecycle/shared.ts, the `runTestGate` loop) including the flaky/`rerunCommand` re-run; each attempt re-acquires, it never holds the slot across an interactive prompt or while an agent or reviewer works;\n- `runPostTaskTests` and the completion check's test run (`validateCompletion`), which only run when the project sets a rex `test` command;\n- gate-only retries (agent/lifecycle/gate-only-retry.ts) go through finalizeRun, so they are covered; check it.\nExport the token as `NDX_VALIDATION_SLOT` into the test command's environment (it goes through `repoCommandEnv`; make sure it survives sanitizing) so a nested runner does not deadlock.\n\nTiming: the queue wait does not count against `hench.fullTestTimeoutMs` (start the gate's timeout after admission), but waiting stops on Ctrl-C and on the run's overall deadline. Cancellation and timeout terminate the test process tree before the slot is released.\n\nRecord it: add `queueMs` and `executionMs` to the run record's gate result (`RunRecord.testGate`) and to post-task test results, with schema validation and round-trip tests (historical records without the fields still load). Print the wait in the terminal while waiting (\"Waiting for the validation slot held by pid … in <project> since …\") and the queue/execution split after the gate, and show both in `hench show` (cli/commands/show.ts).\n\nBehaviour with `hostSlot` unset must be byte-for-byte today's: no lock files, no new output.\n\nOperator notes:\n- Tests use an explicit temp slot directory; never the real ndx home. No `process.env.NDX_*` writes in tests.\n- Extend the existing gate, gate-only retry and schema round-trip suites rather than adding parallel ones.\n- Run the static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy)."
acceptanceCriteria:
  - "With hench.testGate.hostSlot on, every gate attempt and re-run, post-task test run and completion test run executes inside the slot and releases it afterwards, including on failure, timeout and Ctrl-C"
  - "The slot is never held while an agent, a reviewer or an interactive prompt is waiting"
  - "Queue wait is excluded from hench.fullTestTimeoutMs but waiting still ends on Ctrl-C and the run's overall deadline"
  - "Run records carry queueMs and executionMs for the gate and post-task tests; older records without them still load"
  - "The test command's environment carries NDX_VALIDATION_SLOT while the slot is held"
  - "With hostSlot unset, gate behaviour and output are unchanged"
  - "This repository's .n-dx.json sets hench.testGate.hostSlot to true"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
source: "ndx-capture"
blockedBy:
  - "ed2f3d51-97a5-4f5b-8b98-2ff2e2667a10"
---
