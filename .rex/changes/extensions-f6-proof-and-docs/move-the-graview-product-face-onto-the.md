---
id: "490f51c9-4750-49b3-91ec-54ff58b90f97"
type: "task"
title: "Move the Graview product face onto the manifest"
slug: "move-the-graview-product-face-onto-the"
acceptanceCriteria:
  - "`@n-dx/graview-face` declares an `ndx.extension` block; `findProductFace()` and `serveProductApp` are replaced by the generic path"
  - "`ndx graview serve` behaves as before (same flags, same environment), checked by the existing graview tests"
priority: "medium"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "ef7ca789-393d-4663-ac58-8aba713c51ad"
  - "70f98e05-28f8-41cd-8b2a-00daf670b08c"
---
