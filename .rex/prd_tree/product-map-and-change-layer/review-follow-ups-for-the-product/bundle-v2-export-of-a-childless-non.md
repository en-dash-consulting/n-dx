---
id: "dd28f982-a018-43ce-b914-69c07ce565f0"
level: "task"
title: "Bundle v2 export of a childless non-change folder with extra state.yaml keys produces a bundle import refuses"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-15"
  - "lane-rex-store"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Exporting a v2 tree whose childless area or capability folder has a top-level state.yaml key either refuses with a message naming the folder, or produces a bundle that imports into an empty v2 tree with the key in that folder's state.yaml (test)"
  - "Export and import use one shared folder predicate, so no bundle `rex export` writes is refused by `rex import-bundle` for folderState (test)"
description: "Verdict: should-fix (medium). Introduced by dbace75b (commit 0d59ddac8).\n\nFailure scenario (reproduced against the built dist): copy the v2 fixture, delete product/checkout/pay-by-card.md by hand, and append `futureTop: 1` to product/checkout/state.yaml. `rex export` succeeds and the bundle carries folderState.nodes[<area id>] = {futureTop: 1}, because the reader collects extras from every folder with an index.md (prd-model-reader.ts readFolderNode). `rex import-bundle` then refuses: 'Bundle \"folderState.nodes\" names ids that are not folder nodes in this bundle'. The cause is that parseFolderState (prd-bundle-v2.ts, folderNodeIds) counts only changes and nodes with children as folders, matching the writer's isFolderNode. Export and import disagree, so the bundle cannot be imported anywhere.\n\nReachable: a hand-made or hand-edited v2 tree, such as removing the last child file of an area or capability folder. Rex's own writer never leaves a childless non-change folder. It flips such a folder to a leaf, and in doing so its removeStale deletes the folder's state.yaml, extras included. That loss already exists in the writer and is not part of this change.\n\nOptions:\n(a) Recommended. Refuse at export, naming the folder, so the operator fixes the tree before shipping the bundle. Cost: a check in buildBundleV2 against the same folder predicate. Risk: export fails on an odd tree. That matches how a node field named `state` is already refused.\n(b) Have the writer keep any node that has folderState keys as a folder even when it has no children, and have parse accept such ids. Cost: a writer change plus a predicate shared between writer and parse. Risk: a new tree shape the rest of rex does not expect.\n(c) Drop such keys at export with a warning. This loses data, which the forward-compatibility decision on 1628608d rules out.\nChoosing between (a) and (b) is a product decision."
lastModified: "2026-10-08T17:20:57.815Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
