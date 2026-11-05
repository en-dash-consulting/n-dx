---
id: "bd1d2e1d-ee6d-4e95-9e53-4cde3d811515"
type: "task"
title: "A queue-plan lane starts a dependent task when its blocker's run exits 0 without completing"
slug: "a-queue-plan-lane-starts-a-dependent"
description: "Verdict: should-fix (medium), found by the adversarial review of 5aa5da8f (run dd9c5e0c).\n\nDefect: `ndx work --plan-queue` puts a task blocked only by tasks of its own change in the same lane, after its blockers. The lane's command chains `ndx work --task=<id> --auto .` with `&&` (packages/hench/src/cli/commands/plan-queue.ts, laneCommand). That keeps dependency order only if each step exits non-zero whenever its task is left unfinished. Two facts break this:\n- An explicit `--task` does not check blockers. rex resolveWorkById (packages/rex/src/core/change-selection.ts) returns a task ref with no runnable check, and explicitTaskRefusal (hench agent/planning/brief.ts) gates on status only.\n- A single-task run exits 0 in at least one non-completed case: on `error_transient`, cli/commands/run.ts `continue`s the iteration loop without setting process.exitCode. failed, timeout and budget_exceeded do set exitCode = 1.\n\nFailure scenario: a change has tasks A and B, with B blockedBy A. The plan offers lane `ndx work --task=A --auto . && ndx work --task=B --auto .`. A's run hits a transient vendor error, so A stays pending and the process exits 0. B then runs at once, on top of the unfinished A that it depends on.\n\nReachable: through the Ready next copy-paste command on Live, and the CLI plan's lane command.\n\nOptions:\n1. Give each later step a guard that refuses an explicit task with open blockers. This could be a new `--require-unblocked` flag that the lane command passes, or a lane-only check. Cheap, and it changes no other behaviour. Recommended.\n2. Make a single-task run exit non-zero whenever its task did not complete. Broader, and it changes exit codes the dashboard reads.\n3. Stop putting blocked tasks in lanes. The simplest option, but it drops the dependency-chain rule from the done-when of 5aa5da8f."
acceptanceCriteria:
  - "Implements option 1: a lane step for a task whose blocker is not completed does not start that task run, even when the previous step exited 0 (test that fails on the current head)"
  - "A lane whose steps all complete still runs every task in dependency order (test)"
  - "Lanes without blocked tasks run unchanged"
  - "Any new ndx work flag is listed in ndx work --help and gets a release-note line in the patch changeset"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
