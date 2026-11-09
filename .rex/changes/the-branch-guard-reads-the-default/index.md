---
id: "a1ce26d6-b87e-4bb7-bb76-af40a67b31fe"
type: "change"
title: "The branch guard reads the default branch as `heads/main` when a tag named `main` exists"
slug: "the-branch-guard-reads-the-default"
intent: "Out-of-scope finding from the adversarial review of task 4f7ddb95 (currentWorkSetBranch). Verdict: out-of-scope, pre-existing; severity low.\n\n`resolveGitBranch` (packages/rex/src/store/branch-naming.ts) runs `git rev-parse --abbrev-ref HEAD`. When a tag shares the branch's name, git disambiguates the short name and prints `heads/<name>`. The same ambiguity in `symbolic-ref --short` was reproduced by a unit test during the review: a tag named `main` on `main` gives `heads/main`.\n\nScenario: repo on `main` with a tag `main` → `checkBranchGuard` (packages/rex/src/core/branch-guard.ts:55-57) gets `heads/main`, `isDefaultBranch` says false, and whole-tree rewrite commands refuse on the default branch with a message naming `heads/main`. Branch-scoped PRD filenames (`resolvePRDFilename`) also get the wrong segment.\n\nReachable: any rex whole-tree rewrite command in a repo with a tag named like the checked-out branch. Rare, but cheap to fix.\n\nFix (recommended): read `git symbolic-ref --quiet HEAD` and strip `refs/heads/` (as `currentWorkSetBranch` now does), keeping the short-hash fallback for a detached HEAD. Cost: a few lines and one test. Risk: low."
acceptanceCriteria:
  - "With a tag named `main` on branch `main`, resolveGitBranch returns `main` (unit test with a temporary repository)"
  - "With a tag named `main` on branch `main`, checkBranchGuard does not block"
touches:
  - "f648a519-2015-486a-849f-782ba79e970f"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
