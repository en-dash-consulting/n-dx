---
id: "b22d3a8a-7da2-4bcb-afbc-4ca8093b40e5"
level: "task"
title: "rex reshape merges on a v2 tree bypass mergeChanges, dropping touches and aliases and absorbing amending changes"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-33"
  - "lane-rex-store"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a copy of the v2 fixture, an accepted reshape merge of two sibling changes leaves the survivor with the absorbed change's touches, and its id, displayId and former aliases as aliases (test that fails on the current head)"
  - "A reshape merge that would absorb a change carrying amends is refused with a proposal error and writes nothing for that proposal on v2 (test)"
  - "v1 reshape merges are unchanged; existing reshape tests pass unedited"
description: "Found by the adversarial review of 19326fda (commit f3c6f0a99). Verdict: out-of-scope (it predates that change), severity medium.\n\nScenario: on a v2 tree, `rex reshape` opens the change layer (cli/commands/reshape.ts:61, resolveLayerStore) and applies LLM merge proposals through core/reshape.ts applyMerge (line ~166). That function updates the survivor, reparents children and removes the merged items. It never calls mergeChanges (core/merge.ts), which 19326fda made the single v2 merge path. Accepting a merge of two changes therefore loses the absorbed change's `touches`, id, displayId and aliases, so N-DX-Item trailers naming it stop counting toward the survivor. It also absorbs a change that carries `amends`, which mergeChanges refuses: mergeKeepReason only keeps applied changes. Likewise add-reshape.ts applyMergePhase, if it runs on v2.\n\nReachable: `rex reshape --accept` on a v2 tree where the LLM proposes merging two sibling changes. No test covers it.\n\nOptions:\n1. (Recommended) In applyReshape, when the items are a change layer, route a merge through mergeChanges(items, mergedIds, survivorId, { title, description }) and push its refusal as a proposal error. The pattern matches applyProposals({ changeLayer }). Cost: small; v1 is unchanged.\n2. Refuse merge actions on v2 in reshape. Cheaper, but loses the feature."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T20:25:18.350Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
