---
id: "b037993a-b439-4441-b2c3-ccd9509f487e"
level: "task"
title: "Write the v2 trees with frozen slugs and no Children tables"
status: "pending"
priority: "high"
tags:
  - "pr-09"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "12138fcd-c804-4da3-bf3d-10c563ea3397"
source: "roadmap"
acceptanceCriteria:
  - "Editing a title leaves the path unchanged (test)"
  - "No index.md contains a Children table"
  - "v2 fixtures round-trip byte-identically"
description: "The v2 writer: slug written once in frontmatter and never recomputed, so title edits never move files; no Children tables; intent to index.md, state to state.yaml; the slug rule and schema stamp in the root map/index.md instead of tree-meta.json; a change is always a folder."
lastModified: "2026-10-06T04:19:25.813Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
