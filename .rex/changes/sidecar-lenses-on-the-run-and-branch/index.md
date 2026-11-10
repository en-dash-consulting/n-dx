---
id: "6dcba986-4fe6-4d8d-ab84-54d45db119b1"
type: "change"
title: "Sidecar lenses on the run and branch rules"
slug: "sidecar-lenses-on-the-run-and-branch"
intent: "Batch L1 of the Sidecar epic plus story 24 from L2 (Diagnosis and guidance): the Diagnose run, Guide and Diagnose branch lenses narrate R1's run classifier and queue planner and R2's branch health, and act only through broker cards. Stacked on R2 (feat/sidecar-r2-branch-health). Design: local-design-workshop/docs/analysis/sidecar/README.md §3, §5 (Q4, Q5, Q6), §7."
acceptanceCriteria:
  - "Stories 19, 21 and 24 of the Sidecar design (§12, Diagnosis and guidance) are complete"
  - "Nothing in this change turns on web.sidecar, hench.readyNext, git.branchHealth or web.sidecarGithubReads; every lens stays unavailable, naming its toggle, while its source's toggle is off"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "ndx-capture"
---
