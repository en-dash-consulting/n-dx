---
id: "8d89cc25-747e-424d-9d60-2cb72468626e"
level: "epic"
title: "ndx 0.7.1 · Trust and measurement"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "release-epic"
source: "caos work management: epic ndx 0.7.1 · Trust and measurement; 0.7.1 execution plan (2026-09-21)"
acceptanceCriteria:
  - "All six packages are published at 0.7.1 with one git tag each and a GitHub release."
  - "A batch of ndx work tasks comparable to the baseline has run on the published build and its per-model cost, with all four token classes, is recorded beside the $247.53 baseline."
  - "Dashboard token usage and ndx usage report the same per-model totals for the same runs."
  - "Two concurrent ndx work runs in two worktrees select different tasks, and a refused completion does not free the task for another worktree."
  - "Every changeset is a patch; no route changed; new config keys and persisted fields are additive and optional, and older files load unchanged. (Amended 2026-09-23: PR M adds promptCache, promptCacheTtl and prune.* to hench config.)"
description: "Patch release that makes n-dx's numbers true and its autonomous runs trustworthy before any new surface is added. It merges the prompt-caching and context-pruning work that is built and tested but has never run against a live provider, fixes the three defects that misprice runs in the dashboard and CLI, measures a real batch of autonomous tasks against the pre-optimization baseline ($247.53 over 10 runs), closes the gaps left in cross-worktree task claims, ships the plain-language copy fixes from the outside first-use review, and restores per-package git tags and GitHub releases, which have not been produced since 0.4.6 although 0.5.x and 0.6.0 are on npm. Nothing in this release moves a route, a config key or a persisted schema.\n\nGoal: Operators can believe what n-dx reports about cost and progress, two worktrees can no longer duplicate each other's work, and the release history is visible in the repository again."
lastModified: "2026-09-23T18:54:45.405Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Autonomous review capture](./autonomous-review-capture/index.md) | completed |
| [Autonomous runs finish their session](./autonomous-runs-finish-their-session/index.md) | pending |
| [Claims hardening](./claims-hardening/index.md) | completed |
| [Cost measurement lands](./cost-measurement-lands/index.md) | pending |
| [Hench commit hygiene](./hench-commit-hygiene/index.md) | pending |
| [PRD write guards](./prd-write-guards/index.md) | pending |
| [Prompt cache, prune and budget configuration](./prompt-cache-prune-and-budget/index.md) | pending |
| [Release plumbing](./release-plumbing/index.md) | pending |
| [Trust copy](./trust-copy/index.md) | pending |
| [Vendor-aware hench model and provider settings](./vendor-aware-hench-model-and-provider/index.md) | pending |
