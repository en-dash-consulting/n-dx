---
id: "560e45a1-7d0d-45d0-b268-f420520dcc26"
level: "task"
title: "Address #442 review: tree-diff and branch-guard correctness"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "prd-storage-additive"
  - "pr-18"
source: "adversarial review of PR #442 (endash-shal, 2026-09-29), 0.8.0 PR B2"
acceptanceCriteria:
  - "With origin/HEAD pointing at a pruned ref, the branch guard and a bare rex tree-diff fall back to main/master (test)."
  - "rex tree-diff's scratch checkout runs no git hooks; a failing post-checkout hook does not fail it (test)."
  - "When either tree-diff side is present: false, sv pr-markdown records a warning instead of rendering an empty or whole-project Completed Work, and rex tree-diff's text output says the baseline has no tree (tests)."
  - "sv pr-markdown passes --from only when a base branch was given, and labels the base from tree-diff's sources.from (test)."
  - "rex ready --item <id> with a space parses the id (test)."
  - "hench's slug-migration offer and the dashboard's migration route no longer pass --allow-on-branch; on a feature branch the user sees rex's refusal naming the branch (tests)."
description: "Fixes from the #442 review (findings 2, 3, 3b, 6, 7, 7b, 8, 9, 11).\n\n- #3/#3b: `git symbolic-ref refs/remotes/origin/HEAD` prints a pruned target and exits 0, so a stale origin/HEAD (e.g. origin/master after a rename) is trusted. `isDefaultBranch` (packages/rex/src/store/branch-naming.ts) and `resolveAnchorRef` (packages/rex/src/core/tree-source.ts) must verify the target exists before using it, otherwise fall back to main/master.\n- #9: tree-diff's scratch `git checkout` (tree-source.ts) runs the repo's post-checkout hook; pass `-c core.hooksPath=<empty dir>` so no hooks run.\n- #2: packages/sourcevision/src/analyzers/branch-work-collector.ts reads only `completed` from `rex tree-diff --json` and ignores `sources.from.present` / `sources.to.present`, so a legacy prd.md project gets an empty Completed Work with no warning and a base ref that predates the tree credits every completion to the branch.\n- #8: rex tree-diff's text output keys its 'baseline has no tree' notice off warning text that loadTreeAtRef never emits; key it off `present === false`.\n- #6: the collector passes `--from=<local main>` from detectBaseBranch, overriding tree-diff's origin/HEAD default; pass --from only when a base branch was given explicitly, and take the base label from tree-diff's `sources.from`.\n- #11: `item` is not in VALUE_KEYS (packages/rex/src/cli/index.ts), so `rex ready --item <id>` misparses.\n- #7/#7b (decision: option a): hench's slug-migration offer (packages/hench/src/cli/slug-migration-offer.ts) and the dashboard's migration route (packages/web/src/server/routes-hench.ts) pass --allow-on-branch unconditionally, bypassing the branch guard. Stop passing it, so on a feature branch the user sees rex's refusal."
lastModified: "2026-09-29T17:44:03.077Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
