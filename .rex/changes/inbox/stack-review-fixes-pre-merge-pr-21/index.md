---
id: "8d4bc360-ea71-46eb-a79a-ff4a698bdd62"
type: "change"
title: "Stack review fixes: pre-merge (PR 21)"
slug: "stack-review-fixes-pre-merge-pr-21"
intent: "The six findings from the 2026-10-17 re-review (round 2) of #822–#825 that Ryan triaged as must land before the stack merges; the rest are deferred to issues #826–#831. Three of them turn required CI checks green on run 39028377207 (Build & Validate; Tests (Windows, rex+sourcevision)). Stacked on #825 (PR 20), branch feat/sv-lang-pr21-premerge-fixes. #823–#825 merge together, and PR 21 goes with them.\n\nReviews: https://github.com/en-dash-consulting/n-dx/pull/822#pullrequestreview-5559040488, https://github.com/en-dash-consulting/n-dx/pull/825#pullrequestreview-5559040931."
acceptanceCriteria:
  - "Build & Validate and Tests (Windows, rex+sourcevision) pass on the PR 21 head"
  - "A markerless repository with JS only in a TypeScript-skipped directory is detected and inventoried consistently"
  - "The changesets describe the shipped detection rule, the inventory fingerprint, and only the linearity actually delivered"
  - "One unreadable or malformed Java build file no longer degrades the whole Java pack"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "ci"
  - "release-notes"
  - "pr-21"
source: "review"
blockedBy:
  - "dd9c5ff1-38fe-4dea-8b31-ebc9271f8a37"
---
