---
id: "e39f56ef-e79b-437b-b0cf-5f046e00692f"
type: "task"
title: "Report one outcome when the MCP guard fires during a checkpoint"
slug: "report-one-outcome-when-the-mcp-guard"
description: "PR #1008 review comment https://github.com/en-dash-consulting/n-dx/pull/1008#discussion_r4558509480. In packages/web/src/server/sidecar/session-registry.ts, when the guard interrupts the checkpoint, the catch appends 'Checkpoint failed...' and guard.settle(result) then appends a second failure and turns the delivered turn into failed (reaching lastTurn and onTurnSpend) while delivered stays true. A Stop during the checkpoint shows a red 'Checkpoint failed ... Checkpoint interrupted'. Experimental web.sidecar only; spend and answer are both kept today."
acceptanceCriteria:
  - "When the guard fires during a checkpoint, the transcript shows the guard's reason once and no checkpoint-failed diagnostic."
  - "A Stop during a checkpoint is reported as a stop, not a failure."
  - "A test covers the guard-during-checkpoint path."
priority: "low"
source: "ndx-capture"
---
