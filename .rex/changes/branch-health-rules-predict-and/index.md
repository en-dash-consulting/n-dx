---
id: "477c02f8-fba6-46ea-93ef-19fbf9293954"
type: "change"
title: "Branch health rules: predict and classify merge conflicts, report PR and stack state"
slug: "branch-health-rules-predict-and"
intent: "Batch R2 of the Sidecar epic (stories 22 and 23, Diagnosis and guidance): rule-based, LLM-free branch health in the web server. Task 22 collects branch status per worktree (ahead/behind, merge-tree conflict prediction, stack containment, and PR checks when GitHub reads are allowed); task 23 classifies each predicted conflict and offers a deterministic fix. Stacked on R1 (feat/sidecar-r1-run-rules). The Sidecar's Diagnose branch lens (L2) and the hub narrate these outputs later."
acceptanceCriteria:
  - "Stories 22 and 23 of the Sidecar design (§12, Diagnosis and guidance) are complete"
  - "Every output is advisory: R2 runs no fix, writes no file in the worktree and posts nothing to GitHub"
touches:
  - "81e855bf-c278-46b7-924f-d5a3c4227b22"
priority: "high"
---
