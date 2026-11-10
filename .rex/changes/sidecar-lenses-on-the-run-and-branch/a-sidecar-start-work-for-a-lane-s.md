---
id: "99f8a9e1-7454-4780-acb6-393062ef0b1a"
type: "task"
title: "A Sidecar start_work for a lane's later task still starts over an unfinished blocker when the agent omits requireUnblocked"
slug: "a-sidecar-start-work-for-a-lane-s"
description: "Verdict: should-fix (medium), found by the adversarial review of fd15413c (run f0367468).\n\nDefect: fd15413c made `requireUnblocked` a run option. The run-plan result and the Guide instructions now name `start_work options {\"requireUnblocked\":true}` for a step carrying `--require-unblocked`. The guard is only as good as the agent's compliance, though. The server does not tie a start_work call to the approved run-plan lane step it came from (carry-out.ts `carryOut` \"start_work\" passes `workOptions(input)` as given; routes-sidecar.ts `startWork` checks nothing about blockers on its own).\n\nFailure scenario: lane [A, B], with B blockedBy A. A's run ends without completing. In a later turn the agent raises start_work for B but drops the options (a model paraphrasing the instruction). The work card now lists \"Waiting on unfinished blockers: - A (id, pending)\" (fd15413c), but approving it starts B on top of the unfinished A, as before.\n\nReachable: Sidecar Guide → propose_run_plan → Start lane → a later turn's start_work without options.\n\nOptions:\n1. Sidecar start_work defaults `requireUnblocked: true` unless the call passes `false` explicitly. This is cheap (workOptions in carry-out.ts, so preview and start agree), and the work card's command shows the guard. The risk: an agent-proposed re-run of a task with open blockers is refused until the agent passes false. Recommended.\n2. The broker remembers the approved run-plan card per session, and start_work for a task in that lane inherits the lane step's options. This is exact to the plan but needs new broker state across turns.\n3. Leave it to the operator, who now sees the blockers on the card. Zero cost, but the operator still has to notice."
acceptanceCriteria:
  - "A Sidecar start_work for a task with a blocker not completed, raised without any options, starts no run when approved, and its tool result names the open blocker (test that fails on the current head)"
  - "A start_work that passes requireUnblocked: false explicitly still starts the task, and its work card shows no --require-unblocked (test)"
  - "The work card preview's command line and the started run's argv agree on --require-unblocked in both cases (test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
