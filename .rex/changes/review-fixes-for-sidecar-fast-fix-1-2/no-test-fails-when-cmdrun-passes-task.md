---
id: "a5b0d661-af3a-4632-bdd4-d4466ebac054"
type: "task"
title: "No test fails when cmdRun passes --task as typed to the pre-run planning commit"
slug: "no-test-fails-when-cmdrun-passes-task"
description: "Verdict: should-fix (medium). This is a test-quality gap. The defect itself is fixed.\n\n**What happens.** In `packages/hench/src/cli/commands/run.ts` (cmdRun, around line 2402), the planning commit's trailer id comes from `resolveTaskRefId(rexDir, flags.task, …)`. Suppose that call is reverted to `itemId: flags.task`. Then `hench run --task=CH-1` writes `N-DX-Item: CH-1` again, and every test still passes.\n\n**Why.** `tests/integration/pre-run-gate-planning-item-id.test.ts` calls `resolveTaskRefId` and `performPreRunCommitGateIfNeeded` directly, never through cmdRun.\n\n**Reachable.** Yes: every `ndx work --task=<display id|change>` run on a v2 PRD with dirty planning files.\n\n**Options**\n- (a) Recommended. Drive cmdRun non-dry against a v2 fixture repo with a dirty planning file, using the scripted Claude CLI helper (`tests/helpers/scripted-claude-cli.ts`) so the run ends quickly. Then assert the planning commit's N-DX-Item. Cost: one integration test, with fixture setup like `run-per-task-settings.test.ts`.\n- (b) Pull the gate's option building out of cmdRun into an exported function and unit-test it. It is cheaper, but it reshapes cmdRun only for the sake of a test."
acceptanceCriteria:
  - "A hench test runs cmdRun with --task=CH-1 on a v2 repo with a dirty planning file and asserts the planning commit's N-DX-Item is the resolved task id"
  - "That test fails if cmdRun passes flags.task to the gate as typed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
