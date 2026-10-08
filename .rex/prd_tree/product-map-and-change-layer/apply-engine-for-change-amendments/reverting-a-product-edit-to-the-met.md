---
id: "73a63ca4-4885-4d78-9245-c066dc82c072"
level: "task"
title: "Reverting a product edit to the met spec leaves its open draft proposing the abandoned edit"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-10"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Editing a met capability A→B, then B→A, leaves no open product-edit draft amending it (test)"
  - "After that revert the node has no revisedAt and reads met (test)"
  - "The result tells the caller what happened to the draft (outcome or returned change), and the input tree is unmodified (test)"
description: "Verdict: should-fix. The defect is real, but nothing reaches it until handleProductEdit is wired to a CLI or MCP path.\n\nScenario: capability A1.1 was met at statement A. A steward edits it to B, and handleProductEdit drafts change 1 with proposed B. The steward then edits B back to A. Now handleProductEdit (packages/rex/src/core/product-edit.ts, the early `if (specHash(specOf(found)) === found.metAt) return { tree, outcome: \"unchanged\" }`) returns before it looks for the open draft. Change 1 stays open, still proposing B, and A1.1 keeps its revisedAt from the first edit. Applying change 1 later writes B over A and stamps metAt at B, so the steward's revert is silently lost. This is the same defect class as 87c26750, through the one path its fix (refresh the open draft) does not cover.\n\nThe planned `Amendment.base` refusal (8cfdb939) does not catch this either: the draft's base would be A's hash, which equals the node's current hash after the revert.\n\nOptions:\n(a) Recommended. In the unchanged branch, when an open product-edit draft amends the node, cancel the draft (or report it so the caller can), and clear the node's revisedAt. The result should say what happened, e.g. outcome \"reverted\" with the change. Cheap. Whether the draft is cancelled, deleted, or only reported is the user's decision; if the draft has been placed or has tasks under it, cancelling may need a guard.\n(b) At apply time, refuse a product-edit amendment whose proposed spec matches neither the node's current spec nor any later edit. This needs history the tree does not hold, so it is costly.\n\nDecision (2026-10-07, Ryan): option (a). When an edit brings the spec back to metAt and an open product-edit draft amends the node, cancel that draft and clear the node's revisedAt, and say so in the result."
lastModified: "2026-10-08T00:30:46.844Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
