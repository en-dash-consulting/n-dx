---
id: "c977ae06-2e11-4cb7-9f80-e1a2ad155363"
type: "change"
title: "Sidecar rule lenses read the right run and the right base"
slug: "sidecar-rule-lenses-read-the-right-run"
intent: "Review fixes for #945 (Sidecar L1: Diagnose run, Guide, Diagnose branch), from Hal's adversarial review of 2026-11-04 (F1–F4). Diagnose run must not call an orphaned run running or miss a run made in another worktree; GitHub reads must not call a stacked PR's parent 'main' or run the branch-health collector while git.branchHealth is off."
acceptanceCriteria:
  - "The four findings in the #945 review (F1–F4) are fixed, each with a test that fails without its fix"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "ndx-capture"
---
