---
id: "c0463256-664c-4757-aa13-b2de127f51f3"
type: "task"
title: "A v2 folder node that becomes a leaf strands its non-tree files in an index-less folder"
slug: "a-v2-folder-node-that-becomes-a-leaf"
description: "From the adversarial review of 2f7c79a5 (run 37eb42bc). Verdict: out-of-scope (it predates that change), low. It is the same defect class as 2f7c79a5, which carries non-tree files only when a folder node changes directory.\n\nFailure: an area or capability folder (product/<area>/<cap>/) also holds a non-tree file (notes.txt, a .png). Its last child is removed, so isFolderNode is false and writePrdModel (packages/rex/src/store/prd-model-writer.ts, planFolder leaf branch) writes <cap>.md in the parent. The old folder goes stale. removeStale/removeTreeFiles deletes only .md and state.yaml, so the folder survives with notes.txt and no index.md. From then on every read warns \"Folder has no index.md; skipped with its contents\" (prd-model-reader.ts readFolderNode), and the file is no longer beside its node.\n\nReachability: writePrdModel callers that remove the last child of a product folder node, such as remove, move or reshape on a v2 tree. Changes are always folders, so this is product layer only.\n\nOptions:\n(a, recommended) Refuse the leaf flip while the old folder holds non-tree files, and name them. This matches assertNoStrandedState for extra state.yaml keys. Cost: a small check in the leaf branch. Risk: low, because it blocks rather than loses anything.\n(b) Keep the node a folder while it holds non-tree files. This makes a childless non-change folder a legal shape, which dd28f982 rejected."
acceptanceCriteria:
  - "Removing the last child of a capability folder that holds notes.txt is refused before anything is written, and the error names notes.txt (test)"
  - "No write leaves a product folder without an index.md that the next loadPrdModel warns about (test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "lane-rex-store"
  - "pr-23"
source: "ndx-adversarial-review"
---
