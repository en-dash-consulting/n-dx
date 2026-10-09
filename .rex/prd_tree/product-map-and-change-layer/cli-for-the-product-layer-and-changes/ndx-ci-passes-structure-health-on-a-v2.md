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
  - "ndx ci on a v2 tree whose tree rules report an error marks the structure-health step failed (test in tests/e2e or tests/integration)"
  - "ndx ci's structure-health detail on a v2 tree never prints \"undefined\""
  - "A v1 tree's structure-health step is unchanged"
description: "Verdict: should-fix (medium).\n\nScenario: on a v2 tree (.rex/product/ exists), `rex health --format=json` now prints `{ \"treeRules\": [...] }` with no `overall` (task f5d8c06e). packages/core/ci.js:410-433 parses that output and fails the step only when `healthData.overall < 50`. `undefined < 50` is false, so `ndx ci` reports \"✓ structure health (score: undefined)\" and passes, even when treeRules holds error-severity findings such as layer-nesting or depends-on-acyclic. Before f5d8c06e, `rex health` crashed on v2 trees, so the step failed loudly.\n\nReachable: `ndx ci .` on any v2 repository. Rare today, because this repository's PRD is v1.\n\nOptions:\n1. Make `rex health` exit non-zero when any treeRules finding has severity \"error\", and teach ci.js to render a v2 detail (counts of errors and warnings) when `treeRules` is present. Recommended: the exit code gates the step whatever the JSON shape.\n2. Only change ci.js to treat a `treeRules` payload as failing on any error. This keeps `rex health`'s exit code at 0, unlike `rex validate`.\n\nDecision for the owner: whether `rex health` should gate (exit 1) on tree rule errors, or stay advisory and leave gating to ci."
lastModified: "2026-10-09T06:34:08.144Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
