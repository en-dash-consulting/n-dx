---
id: "b037993a-b439-4441-b2c3-ccd9509f487e"
type: "change"
title: "Write the v2 trees with frozen slugs and no Children tables"
slug: "write-the-v2-trees-with-frozen-slugs"
intent: "The v2 writer: slug written once in frontmatter and never recomputed, so title edits never move files; no Children tables; intent to index.md, state to state.yaml; the slug rule and schema stamp in the root product/index.md instead of tree-meta.json; a change is always a folder."
acceptanceCriteria:
  - "Editing a title leaves the path unchanged (test)"
  - "No index.md contains a Children table"
  - "v2 fixtures round-trip byte-identically"
touches:
  - "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
priority: "high"
tags:
  - "pr-09"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
blockedBy:
  - "12138fcd-c804-4da3-bf3d-10c563ea3397"
---
