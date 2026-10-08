---
id: "c0dc9b3f-bec0-4672-89bc-b6f051d4b18d"
level: "task"
title: "The v2 writer silently drops a folder's top-level state.yaml keys when the folder loses its last child"
status: "pending"
priority: "low"
description: "Found by the PR 15 review of dbace75b (run a21e3ec9; see capture dd28f982). Pre-existing writer behaviour, not introduced by the bundle work.\n\nFailure: when rex removes the last child of an area or capability folder, writePrdModel (packages/rex/src/store/prd-model-writer.ts) turns the node into a leaf file because isFolderNode is false, and removeStale deletes the folder, including its state.yaml. Any top-level state.yaml keys other than schema and items (written by a newer rex at the same rex/v2 stamp; StateFileSchema is passthrough and the state writer promises to keep unknown keys) are lost with no warning. That contradicts the forward-compatibility rule behind Ryan's option A on 1628608d: an older rex never silently drops what a newer one wrote.\n\nReachable once the v2 store is wired into write paths (remove, move, reshape on a v2 tree). Not reachable today.\n\nOptions:\n(a) Refuse the write and name the folder and its keys, so the operator decides. \n(b) Warn, and move the keys to the parent folder's state.yaml under a namespaced key.\n(c) Keep the node a folder while its state.yaml has extra keys (this makes childless folders a legal shape, which dd28f982 rejected for bundles).\nRecommendation: (a), consistent with the bundle export refusal in dd28f982."
lastModified: "2026-10-08T17:38:23.071Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
