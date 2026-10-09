---
id: "c9af97e0-2692-42f1-b194-452e04513d26"
level: "task"
title: "ndx ci passes structure health on a v2 tree with \"score: undefined/100\", ignoring tree rule errors"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex health on a v2 tree exits non-zero when a tree-rule finding has severity error, and exits 0 when there are only warnings (test)"
  - "ndx ci on a v2 tree whose tree rules report an error marks the structure-health step failed (test in tests/e2e or tests/integration)"
  - "ndx ci's structure-health detail on a v2 tree shows error and warning counts and never prints \"undefined\""
  - "A v1 tree's rex health exit code and ndx ci structure-health step are unchanged (test)"
  - "rex health on a v2 tree exits non-zero when the reader skipped a node (a folder with no index.md, or invalid node intent), and exits 0 when the only reader warnings are benign, such as a slug that differs from the stored name (test)"
description: "Verdict: should-fix (medium).\n\nScenario: on a v2 tree (.rex/product/ exists), `rex health --format=json` now prints `{ \"treeRules\": [...] }` with no `overall` (task f5d8c06e). packages/core/ci.js:410-433 parses that output and fails the step only when `healthData.overall < 50`. `undefined < 50` is false, so `ndx ci` reports \"✓ structure health (score: undefined)\" and passes, even when treeRules holds error-severity findings such as layer-nesting or depends-on-acyclic. Before f5d8c06e, `rex health` crashed on v2 trees, so the step failed loudly.\n\nReachable: `ndx ci .` on any v2 repository. Rare today, because this repository's PRD is v1.\n\nOptions:\n1. Make `rex health` exit non-zero when any treeRules finding has severity \"error\", and teach ci.js to render a v2 detail (counts of errors and warnings) when `treeRules` is present. Recommended: the exit code gates the step whatever the JSON shape.\n2. Only change ci.js to treat a `treeRules` payload as failing on any error. This keeps `rex health`'s exit code at 0, unlike `rex validate`.\n\nDecision for the owner: whether `rex health` should gate (exit 1) on tree rule errors, or stay advisory and leave gating to ci.\n\nDecided (Ryan, 2026-10-09): option 1. On a v2 tree, `rex health` exits non-zero when any tree-rule finding has severity \"error\"; warnings alone exit 0. ci.js renders the v2 detail (error and warning counts) when the payload has `treeRules`, and gates the step on rex health's exit code. v1: rex health's exit code and ci.js's score-based step are unchanged.\n\nAlso decided (Ryan, 2026-10-09, extends 2c49542e): rex health on a v2 tree also exits non-zero when a reader warning means a node was skipped (missing or invalid root index.md, a folder with no index.md skipped with its contents, invalid node intent skipped). Mark those warnings as skips in the reader (ParseWarning is an internal store type; this is not a schema change) instead of matching message text. Benign warnings (orphan state row, slug differs from the stored name, ignored run block, state field in frontmatter) are still printed and do not change the exit code. The JSON keeps `warnings` beside `treeRules`; do not turn warnings into rule findings."
lastModified: "2026-10-09T14:43:09.200Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
