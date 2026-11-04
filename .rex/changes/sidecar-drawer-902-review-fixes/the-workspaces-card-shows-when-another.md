---
id: "1ec42c31-1ed5-4989-881c-3368dc86b8aa"
type: "task"
title: "The Workspaces card shows when another worktree took over a run's task"
slug: "the-workspaces-card-shows-when-another"
description: "#902 F4 (low, should-fix; behaviour outside the flag). Removing the Sessions tray removed the only rendering of a claim takeover, which #393 shipped (\"A run whose task another worktree takes over mid-run now says so in the dashboard's Sessions tray\"). GET /api/worktrees still returns runs.latest.claimLostTo (routes-worktrees.ts), but no viewer file reads it; the only reference is the type in hooks/use-worktrees.ts. The PR body says the Live tab and Work › Workspaces cover it, but neither renders claimLostTo.\n\nDecided: option (a). Render the takeover on the Workspaces card, which already fetches /api/worktrees.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #902."
acceptanceCriteria:
  - "A Workspaces card whose worktree's latest run has claimLostTo shows that the run's task was taken over by the named worktree"
  - "A viewer test renders a worktree with claimLostTo set and asserts the notice"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "review:#902-F4"
source: "ndx-adversarial-review"
---
