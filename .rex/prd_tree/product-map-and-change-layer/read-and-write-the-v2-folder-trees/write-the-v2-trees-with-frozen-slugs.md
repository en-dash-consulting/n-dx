---
id: "b037993a-b439-4441-b2c3-ccd9509f487e"
level: "task"
title: "Write the v2 trees with frozen slugs and no Children tables"
status: "completed"
priority: "high"
tags:
  - "pr-09"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "12138fcd-c804-4da3-bf3d-10c563ea3397"
source: "roadmap"
startedAt: "2026-10-07T18:22:58.475Z"
completedAt: "2026-10-07T18:34:15.347Z"
endedAt: "2026-10-07T18:34:15.347Z"
resolutionType: "code-change"
resolutionDetail: "Added store/prd-model-writer.ts (writePrdModel), 17 tests, and canonicalized the v2 fixture. Commit 454b14880."
acceptanceCriteria:
  - "Editing a title leaves the path unchanged (test)"
  - "No index.md contains a Children table"
  - "v2 fixtures round-trip byte-identically"
description: "The v2 writer: slug written once in frontmatter and never recomputed, so title edits never move files; no Children tables; intent to index.md, state to state.yaml; the slug rule and schema stamp in the root product/index.md instead of tree-meta.json; a change is always a folder."
lastModified: "2026-10-07T18:34:15.566Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
