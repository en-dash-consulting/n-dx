---
id: "9d2963bb-d91a-4272-a617-48a098d9469f"
type: "change"
title: "Queue plan lanes after the first come with worktree-scoped commands"
slug: "queue-plan-lanes-after-the-first-come"
intent: "Option (a) of finding F4 in Hal's review of #907 (https://github.com/en-dash-consulting/n-dx/pull/907#discussion_r4469225543); option (b), saying each later lane needs its own worktree, is in change 224cd1eb. Today laneCommand (packages/hench/src/cli/commands/plan-queue.ts) targets '.' for every lane, so the operator must make a worktree by hand. Emit each lane after the first as a command that creates or reuses a worktree for the lane's branch and runs there, so the Live panel and the Sidecar's Start lane (#945) can start lanes side by side without colliding."
acceptanceCriteria:
  - "Each lane after the first carries a command that runs in its own worktree (created with git worktree add, or reused) and never in this one (tested)"
  - "Starting two lanes from the plan at once does not trip either lane's dirty-tree gate (integration test)"
touches:
  - "6b0c3873-5607-4adc-9027-abd8d70ab0e3"
priority: "low"
source: "pr-review"
discoveredFrom: {"item":"eef3d129-ffc2-4598-bfce-a30c88faf4ef"}
---
