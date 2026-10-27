---
id: "0c6405bd-5832-4a4a-a797-45ab97ca76d5"
type: "task"
title: "The v2 writer drops a moved folder node's top-level state.yaml keys"
slug: "the-v2-writer-drops-a-moved-folder"
description: "From the adversarial review of c0dc9b3f (run fa78ee63). Verdict: out-of-scope (it predates that change), low. It is the same defect class as c0dc9b3f.\n\nFailure: a folder node (area or capability with children) whose state.yaml holds a top-level key other than schema/items, written by a newer rex at rex/v2. The model moves the node under another parent and calls writePrdModel. planFolder (packages/rex/src/store/prd-model-writer.ts) builds the new folder's state from loaded.files.get(newDir) (absent) plus options.folderState (prd-model-transaction.ts passes none). The old folder becomes stale and removeStale deletes its state.yaml, so the key is lost with no warning. 908c0610 carried item rows across moves (loaded.rows) but not top-level keys.\n\nVariant: a move combined with a leaf flip skips c0dc9b3f's assertNoStrandedState, because that guard only looks at join(dir, node.slug) in the new parent.\n\nReachability: only through writePrdModel callers that move nodes (the v2 transaction, and remove/move/reshape once the v2 store is wired). Not reachable from the CLI today.\n\nOptions:\n(A, recommended) In loadAllStateFiles, record which folder each folder node's own index.md id lives in, so planFolder can merge the old folder's extra top-level keys when the node moved, and assertNoStrandedState can look up the old folder by node id rather than by path. Cost: a small map and two lookups. Risk: low.\n(B) Refuse any move of a folder node whose state.yaml has extra keys. This is cheaper, but it blocks legitimate moves."
acceptanceCriteria:
  - "A folder node whose state.yaml holds an extra top-level key (e.g. futureKey) keeps that key in its new folder's state.yaml after writePrdModel moves it under another parent (regression test in prd-model-writer.test.ts)"
  - "A folder node that moves and loses its last child in the same write is refused, naming its old folder and the extra keys, with the tree left byte-identical (regression test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "rex"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
---
