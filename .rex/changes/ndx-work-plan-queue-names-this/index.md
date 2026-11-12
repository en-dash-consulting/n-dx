---
id: "fc361ba3-af63-4c71-9687-296e182d0eaa"
type: "change"
title: "ndx work --plan-queue names this worktree's own claim as \"claimed by another worktree\" in a blocked work set"
slug: "ndx-work-plan-queue-names-this"
intent: "Found by adversarial review of task 15984ff5 (work sets: blocked sets say which and why). packages/hench/src/cli/commands/plan-queue.ts passes TaskClaims.liveClaims() — every live claim, this worktree's own included — to branchWorkSet as `claims`, and rex's unpickableUnits (packages/rex/src/core/change-selection.ts) words every claim as \"claimed by another worktree: <root>\". Scenario: `ndx work` in worktree A holds the only open task of feat/x's work set; `ndx work --plan-queue` in the same worktree prints \"<task> [in_progress]: claimed by another worktree: /path/to/A\" — A is this worktree. Reachable from --plan-queue on any work-set branch while a run holds a set task. Verdict should-fix (low): the path shown lets a reader work it out, nothing is decided wrongly; the exit code (1) is right. Options: (1, recommended) split liveClaims into foreign and own in plan-queue and pass own ids as excludeIds with their own reason (\"held by a run in this worktree\") — needs rex to accept a reason for excludeIds or a second map; (2) pass only foreignClaims and excludeIds for own claims, which reads \"excluded from this selection\" — cheaper, less specific."
acceptanceCriteria:
  - "When this worktree's own run holds a work-set task, `ndx work --plan-queue` does not describe that claim as held by another worktree (integration test)"
  - "A claim held by a different worktree is still named with its worktree root"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "low"
discoveredFrom: {"item":"15984ff5-933e-4fd7-bbb9-3ca3b6f5c446","run":"519f1d49-d554-4c3f-b5d4-6dfdbc08a253"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
