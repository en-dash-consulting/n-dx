---
id: "26754ed7-50fa-4181-a0cf-fd2b32e8e423"
type: "task"
title: "Branch health reads the PR's merge state and stack when classing a check, classifies over the whole log, and defers gh to expansion"
slug: "branch-health-reads-the-pr-s-merge"
description: "Found by testing task 22 (18f3e71f) on real worktrees on 2026-10-29. PR #907 (feat/sidecar-r1-run-rules, stacked on feat/sidecar-m3-lenses) had one failing check, \"Tests (Windows, root+llm-client)\", failing in packages/llm-client tests/integration/vendor-session.test.ts. The PR's mergeStateStatus was BEHIND, and two stack layers below (feat/sidecar-m2-drawer, feat/sidecar-m1-core) had new commits the branch lacked, one of them the fix for that very test. Branch health still classed the check unclassified. Three defects:\n1. classifyFailingCheck never sees the PR's mergeStateStatus or the stack, so behind-base only fires when the log text says so.\n2. The classifier reads the capped tail, not the whole log: the failed-file lines sit above the last 80 lines, so touched-test cannot fire. And gh run view --log-failed prefixes every line with \"<job>\\t<step>\\t<timestamp> \", which used most of the 8,000-character tail (about 25 useful lines).\n3. Every Workspaces card fetches /api/branch-health on mount, so with GitHub reads on, every board open runs gh pr view (and the stack's and logs' gh calls) for every worktree; this repo has 120, and one PR with a failing check took 8.5 s."
acceptanceCriteria:
  - "A failing check on a PR whose mergeStateStatus is BEHIND, or whose stack has a layer not contained, is classed behind-base, and its evidence names the merge state or the uncontained layer (tested both ways)"
  - "The check classifier reads the whole failed log; only the stored and displayed tail is capped. A fixture whose failing test file appears above the last 80 lines is classed touched-test when the branch changed that file"
  - "touched-test matches a package-relative test path in the log (tests/x.test.ts run inside packages/p) against the branch's repo-relative changes (packages/p/tests/x.test.ts), tested"
  - "The stored log tail drops gh's job, step and timestamp prefix from each line before capping; a fixture with prefixed lines yields a tail with none"
  - "The Workspaces strip loads local facts on mount with no gh call; GitHub facts load only when a card's strip is expanded. A viewer test asserts no GitHub request until expansion"
priority: "high"
---
