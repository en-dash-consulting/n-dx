---
id: "1672bb20-6378-4950-847b-30b2508ce3e7"
level: "task"
title: "On a v2 tree hench's completion commit stages product/ and changes/ wholesale, sweeping in operator edits"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Completing a v2 task via the real ChangeLayerStore on the autoCommit path leaves an unrelated dirty file under changes/ out of the completion commit and still dirty (integration test)"
  - "takeSaveFileReport returns the written and deleted product/ and changes/ paths after a v2 transaction"
description: "Verdict: should-fix (medium), found by the adversarial review of f0f2bab6.\n\nScenario: a v2 project with an operator edit in flight under `.rex/changes/<other>/` or `.rex/product/`. A hench `--auto` run completes a task. `commitPrdTreeIfStaged` (packages/hench/src/agent/lifecycle/shared.ts) calls `takeSaveFileReport(store)`. rex's `ChangeLayerStore` has no `takeSaveFileReport`, so the result is null, and hench falls back to the wholesale roots from `prdPathsToStage`, which now include `<rexDir>/product` and `<rexDir>/changes`. The operator's unrelated edit lands in the \"task completed\" commit under hench's trailers. This is the same hazard WM2040 fixed on v1.\n\nReachable: `ndx work --auto` on a v2 tree, via the autoCommit completion commit and `commitResetDeferredChanges`. Not covered: the new v2 test in completion-metadata-commit.test.ts uses a mock store that does return a report.\n\nOptions:\n1. (Recommended) rex: have the v2 transaction / `ChangeLayerStore` record the files each write touched and expose them through `takeSaveFileReport`. This is a rex-lane change. hench's scoping already accepts product/ and changes/ paths. Cost: small in rex.\n2. hench: on v2 with no report, scope staging to the change folder of the completed task. This needs the change's folder path from rex, so it still depends on rex."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:48:32.574Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
