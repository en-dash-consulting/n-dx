---
id: "24d15e85-b4b7-49a4-852a-a9979ffb44b7"
type: "change"
title: "ndx work --task --resolve on a v2 tree reports a task inside a change another worktree claims as runnable"
slug: "ndx-work-task-resolve-on-a-v2-tree"
intent: "Found by the adversarial review of ddd88998 (run 83fa8fc7). Verdict: should-fix.\n\nScenario: on a v2 tree worktree A claims task-less change C and splits it into task T. In worktree B, `ndx work --task=T --resolve .` (the dashboard's Prepare-task preview) reports no claimed-elsewhere refusal and task.claimedBy null. The real run then refuses with TaskClaimedElsewhereError naming C, because ddd88998 added the enclosing-change check to selectTaskEntry only.\n\nEvidence: packages/hench/src/cli/commands/run-resolve.ts:268 calls `heldElsewhere(entry.item.id)` only; packages/hench/src/agent/planning/brief.ts selectTaskEntry checks enclosingChangeIds.\n\nReachable through `ndx work --resolve` and the dashboard prep route. The run itself is not affected: it is refused correctly.\n\nOptions: (a, recommended) on a v2 tree, check enclosingChangeIds(v2Tree, entry.item.id) against foreignClaims() in run-resolve as well, and report the change's claim in claimedBy and the claimed-elsewhere refusal. This costs a few lines and a test. (b) Extract one shared helper used by both selectTaskEntry and run-resolve, so the two cannot drift again. Slightly larger, but prevents recurrence."
acceptanceCriteria:
  - "On a v2 copy where another worktree claims change C, `--resolve` for a task in C reports a claimed-elsewhere refusal naming C and its holder (test)"
  - "--resolve for a task whose enclosing changes are unclaimed, or claimed by this worktree, reports no refusal (test)"
  - "v1 --resolve output is unchanged (existing tests pass unedited)"
touches:
  - "be394022-52c9-4317-ab29-8bfa26523593"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
---
