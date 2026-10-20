---
id: "efafdb61-a186-4756-a31b-d33370d761f3"
level: "epic"
title: "Fix · sourcevision incremental imports drop Go package-directory edges"
status: "completed"
priority: "high"
tags:
  - "fix"
  - "sourcevision"
source: "ndx-capture"
startedAt: "2026-10-17T18:52:16.531Z"
completedAt: "2026-10-17T18:52:16.531Z"
endedAt: "2026-10-17T18:52:16.531Z"
resolutionType: "code-change"
resolutionDetail: "Go directory edges carried forward again; patch changeset added"
acceptanceCriteria:
  - "An incremental analyzeImports keeps unchanged Go files' edges to package directories that still hold an inventoried file, matching a full run."
  - "An edge to a directory whose files are no longer inventoried is still dropped (#744 intent holds)."
  - "A patch changeset for @n-dx/sourcevision describes the fix."
description: "Regression from the #744 fix (b10b60989). `buildIncrementalState` in `packages/sourcevision/src/analyzers/imports.ts` carries a previous edge forward only when `unchanged(edge.from) && fileSet.has(edge.to)`. `fileSet` holds inventoried file paths, but Go regex-parser edges target the imported package's directory (`main.go -> util`), so an incremental analyze drops every unchanged Go file's internal edges. Also makes language-pack stack PR 6 (#765) fail CI. Swift and C# edges target files; only Go emits directory targets."
lastModified: "2026-10-17T18:52:21.059Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Incremental import carry-over keeps edges to inventoried package directories](./incremental-import-carry-over-keeps.md) | completed |
