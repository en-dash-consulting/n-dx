---
id: "793240d0-5f3d-49c7-aff3-9cac77685681"
type: "task"
title: "A run-plan lane whose work card was denied or withdrawn offers no Start lane again"
slug: "a-run-plan-lane-whose-work-card-was"
description: "Verdict should-fix (medium). Scenario: approve a run-plan card with Start lane on lane 1, then deny (or let the turn withdraw) the start_work card the agent raises. runPlanLaneState (packages/web/src/viewer/components/sidecar-cards.ts) returns \"open\", so the badge clears, but RunPlanBody renders the Start lane button only while the plan card is pending (decidable), and the broker refuses a second decision on a settled card (broker.ts decide). The lane cannot be started again from the card; the operator has to ask the agent for a new run-plan card or copy the commands. Task 0729f8d2's criterion asked for the lane to return to \"startable\". Reachable from the Sidecar drawer whenever a work card is denied. Options: (a) let the broker accept a re-pick of lane on an approved run-plan card whose chosen lane's work card ended without a start (costs a broker transition + test; risk: a second carry-out result for one card); (b) a Start lane on the settled card posts a new turn asking the agent to raise start_work for that lane's first task (no broker change; depends on a live session). Recommend (b)."
acceptanceCriteria:
  - "After a lane's work card is denied or withdrawn, the run-plan card shows Start lane for that lane again (card test)"
  - "Choosing it leads to a new start_work card for the lane's first task without a new propose_run_plan card (tested)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
