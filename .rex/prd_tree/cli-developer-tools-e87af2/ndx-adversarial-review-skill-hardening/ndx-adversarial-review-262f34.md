---
id: "262f3436-7206-499e-8fdf-5c93abbe89c1"
level: "task"
title: "/ndx-adversarial-review hardcodes `main` as the branch-diff base"
status: "pending"
priority: "medium"
tags:
  - "skills"
  - "portability"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "No literal `main...HEAD` remains in the canonical skill body"
  - "Step 1 resolves the default branch rather than naming it"
  - "A documented fallback exists for when the default branch cannot be resolved (ask the user)"
  - "The instruction works unchanged in a repo whose default branch is `master`"
description: "**Severity:** medium — **Verdict:** must-fix\n\n**Failure scenario.** Clean working tree in a repo whose default branch is `master`, `develop`, or `trunk`. Step 1's diff-mode fallback runs `git diff main...HEAD`, which exits with `fatal: ambiguous argument 'main': unknown revision or path not in the working tree`. The skill's primary entry mode is left with no target and the assistant has to improvise.\n\nThis is the same defect class already corrected once during authoring — hardcoding this repo's conventions into an asset that `ndx init` installs into arbitrary repositories.\n\n**Evidence.** `packages/core/assistant-assets/skills/ndx-adversarial-review.md` — Step 1, diff-mode bullet. Confirmed no default-branch resolution helper exists anywhere in `packages/` or `scripts/` to reuse.\n\n**Reachability.** Any consumer repo not using `main`, whenever the working tree is clean.\n\n**Possible solutions.**\n1. *Recommended.* Resolve the branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to `git remote show origin`. Correct in most clones, but `origin/HEAD` is sometimes unset locally.\n2. `git diff @{u}...HEAD` against the upstream tracking branch — makes no name assumption, but fails on a branch with no upstream configured.\n3. Ask the user which branch to compare against. Cheapest and never wrong, at the cost of one question.\n\nPair 1 with 3 as the fallback when `origin/HEAD` is unset."
---
