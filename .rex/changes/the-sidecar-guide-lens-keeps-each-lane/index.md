---
id: "2bb9aea2-5f2e-4ee6-8a70-af611b8c6473"
type: "change"
title: "The Sidecar Guide lens keeps each lane in a worktree of its own"
slug: "the-sidecar-guide-lens-keeps-each-lane"
intent: "R2's review fixes (#930) made the queue planner mark lane.ownWorktree: every lane after the first, and lane 1 while a run is live in this worktree, must run in a worktree of its own, because each command targets '.' and two runs in one checkout collide. Live's Ready next shows it; L1's Guide lens does not. The packet lists lanes without it, the run-plan card offers Start lane on any lane, and the work card's startWork checks only the repository-wide run limit, while the execute route refuses only a second run of the same task. So Start lane on lane 2 starts a run in the checkout lane 1 is running in."
acceptanceCriteria:
  - "No Sidecar card starts a run in a checkout that already has a live run, and the Guide lens says which lanes need a worktree of their own"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
source: "ndx-capture"
---
