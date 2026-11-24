---
id: "448c2715-7251-4a80-8a00-a82b9079868f"
type: "task"
title: "Running now opens another worktree's run in this workspace"
slug: "running-now-opens-another-worktree-s"
summary: "Clicking a task running in another worktree from Work › Now opened this workspace's history instead of the live run; it now goes to the run in its own worktree, like Live does."
description: "Review 4672392647 (P2): work-now.ts:90 navigates within the current workspace and discards run.worktree. Fix: use the same run target Live's run cards use (PeekLink/runTarget or liveHref), including the full navigation to the owning worktree's /w/<key>/ slot."
acceptanceCriteria:
  - "A Running now row for another worktree's run links to that run in its worktree's slot"
  - "A run in this worktree still opens in place"
  - "A test covers both"
priority: "medium"
source: "pr-review"
---
