---
id: "2c49542e-49cc-4df6-8a45-aba450c4a19c"
level: "task"
title: "rex health on a v2 tree drops the reader's parse warnings and reports \"no findings\" for a tree with skipped nodes"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex health on a v2 tree containing a node with invalid intent frontmatter reports that node's path and the reader's warning (test)"
  - "rex health on a v2 tree with a folder missing index.md reports the skipped folder (test)"
  - "rex health --format=json on a v2 tree includes the reader warnings in the payload (e.g. a `warnings` array alongside `treeRules`)"
description: "Verdict: should-fix (medium). Introduced by f5d8c06e (the v2 branch of rex health).\n\nScenario: on a v2 tree, a capability whose index.md has invalid intent frontmatter is skipped by loadPrdModel with a warning (packages/rex/src/store/prd-model-reader.ts:376 \"Invalid node intent, skipped\"). The same happens to a folder with no index.md, which is skipped together with its contents (:338). packages/rex/src/cli/commands/health.ts calls loadPrdModel and passes only model.tree to checkV2TreeHealth. It never reads model.warnings. So `rex health` prints \"Tree rules: no findings\" for a tree that is missing whole subtrees. That is a silent wrong answer from the command whose job is to report structural problems. By contrast, cli/commands/codeowners.ts:58 prints model.warnings.\n\nReachable: `rex health` on any v2 repository with a malformed or hand-edited node. Rare today, because this repository's PRD is v1.\n\nOptions:\n1. Print model.warnings under a \"Reader warnings:\" heading in text output, and add `warnings` next to `treeRules` in JSON. Cost: small. Recommended.\n2. Turn each warning into a RuleFinding (rule \"unreadable-node\", severity error), so that it also feeds the ci gating in c9af97e0. Cost: small. It mixes reader output with the rule set.\n\nChosen (overnight 2026-10-09, reversible): option 1. Print model.warnings under a \"Reader warnings:\" heading and add a `warnings` array beside `treeRules` in JSON. Do not turn warnings into RuleFindings; that is tied to the open c9af97e0 decision on gating. v1 output unchanged."
lastModified: "2026-10-09T06:47:44.377Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
