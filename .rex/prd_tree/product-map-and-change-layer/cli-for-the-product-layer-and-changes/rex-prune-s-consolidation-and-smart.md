---
id: "f0b1ce11-bee7-4545-a013-5e918f29b88f"
level: "task"
title: "rex prune's consolidation and --smart can merge away the applied change that retires a product node"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-18"
  - "lane-rex-surface"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A consolidation merge proposal that merges an applied change carrying a removed amendment is skipped with a reason, and the change survives rex prune --accept (test)"
  - "rex prune --smart --accept with the same proposal leaves the change in place (test)"
  - "After either run, rex product show <node> reports the node as retired (test)"
description: "Verdict: should-fix (found by adversarial review of 68cc9f9b).\n\nScenario: on a v2 tree, an applied change with a removed amendment is completed. Plain prune now keeps it (core/prune.ts pruneKeepReason). But `rex prune` runs LLM consolidation after pruning by default (consolidateAfterPrune), and `rex prune --smart` uses reasonForReshape too. Both apply proposals with applyReshape. A `merge` proposal that names this change as a merged item calls removeFromTree (core/reshape.ts applyMerge, ~line 182). changeLayerFromItems (core/layer-projection.ts) then reports it in `removed`, and the change disappears from the change layer. computeProductStatus no longer finds it, so the deleted product node loses its \"retired\" row. `obsolete` is harmless because it only sets the status to deferred and appliedAt still counts.\n\nReachable: `rex prune --accept` with consolidation on (the default), or an operator accepting a merge interactively, or `rex prune --smart`. It needs the LLM to propose such a merge.\n\nOptions:\n1. (Recommended) Guard at the change layer: the ChangeLayerStore write-back refuses, or the reshape layer skips with a reason, any merge or delete of an item where pruneKeepReason(item) is set. This covers reshape, reorganize and prune together. Cost: a small check plus tests.\n2. Filter such items out of the items sent to reasonForReshape in prune's consolidation and smart paths only. Cost: cheaper, but it leaves `rex reshape` exposed."
lastModified: "2026-10-09T16:00:56.581Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
