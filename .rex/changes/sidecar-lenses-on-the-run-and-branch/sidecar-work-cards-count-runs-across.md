---
id: "0729f8d2-ca98-44ed-a772-ee6e56bd1239"
type: "task"
title: "Sidecar work cards count runs across the repository, and a run-plan lane reads Started only once its run starts"
slug: "sidecar-work-cards-count-runs-across"
description: "Follow-up to c5b1bbf2 from its browser check. The run-plan card said 'Active runs: 1 of 3' (the planner's countRepositoryActiveRuns, which counts live runs in every worktree), but the lane's work card said 'Active runs: 0 of 3': runSlotUsage reads only this worktree's slots, so a card can approve a fourth run on the machine. And Start lane marked lane 1 'Started' (sidecar-cards.ts) when it had only raised a work card, which was then withdrawn and started nothing."
acceptanceCriteria:
  - "The work card's active-run count includes live runs in every worktree of the repository, read the way GET /api/live reads them (no hench import in web), and matches the planner's activeRuns for the same moment (tested with a run in a second worktree)"
  - "Approving a start_work card while the repository already has three live runs starts nothing and the tool result names the limit and the runs that hold it (tested)"
  - "On the run-plan card a lane reads 'Work card raised' (or equivalent) after Start lane, 'Started' only once its work card is approved and the run has started, and returns to startable when that work card is denied or withdrawn (tested in the card test)"
source: "ndx-capture"
---
