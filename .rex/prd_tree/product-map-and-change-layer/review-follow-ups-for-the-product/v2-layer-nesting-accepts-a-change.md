---
id: "e4a59da8-b6e6-4840-81e3-531d864b551b"
level: "task"
title: "v2 layer-nesting accepts a change under a change and a task at the changes root"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-16"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "checkV2Rules reports an error for a change whose parent is a change (test)"
  - "checkV2Rules reports an error for a task at the changes root and for a subtask directly under a change (test)"
  - "The v2 fixture tree still passes every rule (test)"
description: "Found reviewing pr-16 (change selection). Verdict: out-of-scope. The rule predates PR 16; it was not introduced there.\n\nFailure scenario: the `layer-nesting` rule (packages/rex/src/schema/v2-rules.ts, layerNesting, about line 542) only checks that a node stays in its own layer. That leaves two shapes unflagged:\n- A change nested inside another change. `core/change-selection.ts` sees no task children, treats the outer change as task-less and selects it as a unit of work, even though it contains a change.\n- A task or subtask placed directly at the changes root, or a subtask directly under a change. Selection never reaches the task, and `resolveWorkById` returns null for it, because no change is its ancestor.\n\nBoth fail silently: `checkV2Rules` reports nothing.\n\nReachability: nothing writes these shapes today, and the v2 store is not wired yet. A hand edit of `.ndx/rex/changes`, or a migration bug, would produce them once v2 lands.\n\nFix options:\n1. Recommended: tighten `layer-nesting`, or add a change-layer rule, so that the change layer only allows `changes root > change > task > subtask`. Cheap: one rule and its tests. Risk: an existing fixture might nest differently, but the v2 fixture does not.\n2. Make selection defensive instead, so it recurses into nested changes. This hides the malformed tree rather than reporting it. Not recommended."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
