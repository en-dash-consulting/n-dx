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
  - "rex reshape --accept with a merge proposal naming any applied change (including one with only modified amendments) skips that proposal with the reason and applies the other accepted proposals (test)"
  - "A delete proposal for a change that pruneKeepReason keeps is skipped with the reason (test)"
  - "The ChangeLayerStore write-back refuses to remove a change that pruneKeepReason keeps, and still lets plain prune remove other completed changes (test)"
description: "Verdict: should-fix (found by adversarial review of 68cc9f9b).\n\nScenario: on a v2 tree, an applied change with a removed amendment is completed. Plain prune now keeps it (core/prune.ts pruneKeepReason). But `rex prune` runs LLM consolidation after pruning by default (consolidateAfterPrune), and `rex prune --smart` uses reasonForReshape too. Both apply proposals with applyReshape. A `merge` proposal that names this change as a merged item calls removeFromTree (core/reshape.ts applyMerge, ~line 182). changeLayerFromItems (core/layer-projection.ts) then reports it in `removed`, and the change disappears from the change layer. computeProductStatus no longer finds it, so the deleted product node loses its \"retired\" row. `obsolete` is harmless because it only sets the status to deferred and appliedAt still counts.\n\nReachable: `rex prune --accept` with consolidation on (the default), or an operator accepting a merge interactively, or `rex prune --smart`. It needs the LLM to propose such a merge.\n\nOptions:\n1. (Recommended) Guard at the change layer: the ChangeLayerStore write-back refuses, or the reshape layer skips with a reason, any merge or delete of an item where pruneKeepReason(item) is set. This covers reshape, reorganize and prune together. Cost: a small check plus tests.\n2. Filter such items out of the items sent to reasonForReshape in prune's consolidation and smart paths only. Cost: cheaper, but it leaves `rex reshape` exposed.\n\nDecided (Ryan, 2026-10-09): option 1, refined.\n\n1. Two guards, not one. The reshape layer (applyReshape, used by rex reshape, rex reorganize and rex prune's consolidation and --smart paths) SKIPS an offending proposal with the reason and still applies the rest of the accepted batch, the same pattern as b1fac5d6. The ChangeLayerStore write-back is a backstop that REFUSES, so a future code path cannot bypass the check.\n\n2. Merges are guarded more widely than deletes.\n   - Merge: never merge away ANY applied change (appliedAt set), whatever its amendments. An applied change's id is the identity that N-DX-Item commit trailers, the rex health landing check and PR 22's shippedIn stamp refer to; folding it into another change breaks all three.\n   - Delete: use pruneKeepReason, the same predicate plain prune uses, so delete and prune agree.\n   - The store backstop uses the delete predicate (pruneKeepReason) only, because plain prune legitimately removes other completed changes through the same write-back; the wider merge guard lives in the reshape layer.\n\nv1 trees are unchanged."
lastModified: "2026-10-09T16:18:32.006Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
