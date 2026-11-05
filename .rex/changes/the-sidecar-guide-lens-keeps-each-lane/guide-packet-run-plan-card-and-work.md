---
id: "8c476b8a-538c-457d-83ae-4cb71925cca5"
type: "task"
title: "Guide packet, run-plan card and work card honour the planner's ownWorktree"
slug: "guide-packet-run-plan-card-and-work"
description: "Follow-up found merging R2 10b750195 into L1 (b8c05d864). Files: packages/web/src/server/sidecar/packet-builders.ts (Guide 'Lanes' section), sidecar/carry-out.ts runPlanResult, viewer/components/sidecar-cards.ts (run-plan card), routes-sidecar.ts previewWork/startWork. Hench's text plan words it 'Run this lane in its own worktree: its command targets the current checkout, and two runs in one checkout collide.' (plan-queue.ts); Ready next uses the same sentence."
acceptanceCriteria:
  - "The Guide packet's lane line for a lane with ownWorktree true says it must run in its own worktree, in hench's wording; a lane without the field reads as before (tested)"
  - "The run-plan card shows Ready next's worktree line under such a lane, and choosing it starts nothing from a card: runPlanResult returns ok false, telling the agent to have the operator run the lane's command from a terminal in a worktree of its own, as the unmapped-flag refusal does (tested)"
  - "startWork refuses with 'Nothing started: …' when a hench run is live in this checkout (ctx.projectDir), naming that run, and previewWork says so on the card before Approve; a live run only in another worktree still counts toward the repository limit alone (tested with a live run here and one in a sibling worktree)"
source: "ndx-capture"
---
