---
id: "b772b0c5-c910-4e92-83bf-776a266c413a"
type: "change"
title: "Bound local test execution across worktrees (validation gate wave 1)"
slug: "bound-local-test-execution-across"
intent: "Wave 1 of the planned-validation-gate proposal (reviewed 2026-11-12). Heavy parallel development across worktrees is limited by local test load, not by test selection. Today nothing bounds it:\n\n- hench's process limiter counts lock files under each checkout's own `.hench/locks/` (packages/hench/src/process/limiter.ts:89), so N worktrees run N gates at once;\n- none of the vitest configs sets `maxWorkers`, so every suite claims all cores, whoever starts it (hench gate, agent `npx vitest`, reviewer, human);\n- the stale-`dist/` rebuild inside the gate (scripts/run-all-tests.mjs `rebuildStalePackages`) has no limit either.\n\nThis wave bounds execution without the plan contract, the coordinator or new selection (those are waves 2 and 3). It ships as a three-PR stack, one PR per task group:\n\n- PR 1 (worker cap): T1–T3.\n- PR 2 (host-wide validation slot in hench): T4–T6.\n- PR 3 (scripts/run-all-tests.mjs takes the same slot): T7–T8.\n\nDesign decisions (made 2026-11-12):\n- Worker cap: one env var, `NDX_TEST_MAX_WORKERS`, read by a shared helper in every vitest config; unset keeps vitest's default, so a human's solo run is unchanged. Hench sets it from `hench.testGate.maxWorkers` for the runs it manages; this repo pilots 2.\n- Host slot: one active validation execution per OS user on the host, shared across worktrees and hench processes, lock state under the ndx home (resolveNdxHome). Opt-in through `hench.testGate.hostSlot` (default off, so other projects keep today's behaviour during the soft freeze); this repo's `.n-dx.json` turns it on.\n- Nesting: hench holds the slot and then spawns the runner, which must not deadlock; the holder passes a token (`NDX_VALIDATION_SLOT`) to its children and a child that sees a live token for the same slot directory runs without re-acquiring.\n- Both settings only tighten what runs, so they respect the untrusted-repository constraint (1bb0333a).\n- Queue wait is recorded apart from execution time and never counts against `hench.fullTestTimeoutMs`; the run's overall deadline and Ctrl-C still apply while waiting.\n\nOut of scope: arbitrary agent shell commands are bounded only by the worker cap, not the slot; plan records, gap reporting, test selection changes and removing the repeated test runs in validateCompletion / post-task tests are waves 2–3."
acceptanceCriteria:
  - "Two opted-in hench runs in separate worktrees on one host never execute managed validation at the same time; the second waits and says what it is waiting for"
  - "Every vitest run in the repository honours NDX_TEST_MAX_WORKERS, and hench sets it for the runs it manages when hench.testGate.maxWorkers is configured"
  - "A hench gate that spawns scripts/run-all-tests.mjs inside the slot does not deadlock, and a run-all-tests.mjs started by hand waits for a hench gate holding the slot"
  - "Run records keep queue time and execution time apart, and queue time does not count against hench.fullTestTimeoutMs"
  - "With hench.testGate.hostSlot and hench.testGate.maxWorkers unset, hench's gate behaviour is unchanged"
amends: [{"target":"f7e6bab2-0bc4-45fc-8743-edcee40b2f2b","delta":"modified","summary":"Bound validation across worktrees: host-wide validation slot and test worker cap","criteria":{"add":[{"id":"c5","text":"When the project opts in, hench shall admit at most one managed validation execution at a time per OS user on the host, across hench processes and worktrees, and shall record queue wait apart from execution time."},{"id":"c6","text":"When a test worker cap is configured, hench shall pass it to every test command it runs and to the agent session's shell."}]},"base":"47a5c32c6f78ba8b2f4241e1746885b974f4d1bbf6e0dd67c7b3f36a416bf110"}]
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "hench"
  - "testing"
source: "ndx-capture"
---
