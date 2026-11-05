---
id: "f3d9768f-177c-4cf1-8e47-8eb7b263366a"
type: "task"
title: "Two work cards approved at once can both start runs in one checkout"
slug: "two-work-cards-approved-at-once-can"
description: "Verdict: should-fix (low). sidecarActions.startWork (packages/web/src/server/routes-sidecar.ts) checks `here` from repositoryRunSlotUsage (awaits listWorktrees) and then calls startTaskExecution, which reserves per task only. Two approvals for different tasks in the same worktree (two Sidecar sessions, or a card plus the dashboard Start) that interleave across that await both see `here` empty and both spawn, so two runs share one checkout. The same check-then-act gap already exists for the repository run limit. Reachable only with near-simultaneous approvals. Options: (a) a per-workspace start mutex around check+start in startWork (cheap, covers sidecar starts only); (b) move the in-checkout check into reserveAndStart before its first await, using a workspace-level reservation (covers every start path; touches the execute route). Recommend (b) if the execute route should refuse too, else (a)."
acceptanceCriteria:
  - "Two startWork calls for different tasks in the same checkout, issued concurrently with no run live, start exactly one run; the other returns 'Nothing started: …' naming the first (tested)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
