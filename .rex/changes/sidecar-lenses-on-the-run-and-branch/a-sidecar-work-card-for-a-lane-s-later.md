---
id: "fd15413c-b43a-4755-8087-7fae64bef710"
type: "task"
title: "A Sidecar work card for a lane's later task starts it while its blocker is unfinished, dropping --require-unblocked"
slug: "a-sidecar-work-card-for-a-lane-s-later"
description: "Verdict: should-fix (medium), found by the adversarial review of c5b1bbf2 (run 8264b19e).\n\nDefect: the run-plan card's Start lane hands the agent the lane's first task for start_work, and the instructions tell it to raise start_work for the next task once the previous run has ended. The planner marks a later lane step whose blocker is in the same lane with `--require-unblocked`. A start_work call cannot carry that flag, because `requireUnblocked` is not a run option. The execute route (routes-hench.ts startTaskExecution) refuses only `status: \"blocked\"`, not a pending task with open `blockedBy`. The work card preview (carry-out.ts renderWorkPreview) does not name open blockers either.\n\nFailure scenario: lane [A, B] with B blockedBy A. A's run ends without completing (transient error, or failed). The plan still lists [A, B]. The agent raises start_work for B, as instructed. The work card shows only \"Task: B (pending)\", and approving it starts B on top of the unfinished A.\n\nReachable: Sidecar Guide → propose_run_plan → Start lane → a later turn's start_work (packages/web/src/server/sidecar/carry-out.ts runPlanResult; lens-instructions.ts GUIDE_INSTRUCTIONS). The work card still gates it, but it gives the operator nothing to decide on.\n\nOptions:\n1. Add a `requireUnblocked` run option (RUN_OPTION_SPECS, flag `require-unblocked`) that the execute route passes to ndx work. runPlanResult then tells the agent to pass it for steps that carry it, and a step's extra flags map to options. Recommended; it matches the planner's own guard.\n2. Make the work card preview list the task's open blockers, and have startWork refuse a task with any blocker not completed. Simpler, but it is stricter than ndx work for an explicit task."
acceptanceCriteria:
  - "A start_work raised for a lane task whose in-lane blocker has not completed starts no run when approved, and its tool result names the open blocker (test that fails on the current head)"
  - "The work card preview for a task with an open blocker lists that blocker by title and id (test)"
  - "A lane step whose command carries --require-unblocked can be started from a work card carrying the equivalent guard, so runPlanResult no longer refuses a first step only because of that flag (test)"
  - "Any new run option is in RUN_OPTION_SPECS and is covered by the execute route's argv test"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
