---
id: "f6ad260e-dd40-4e7f-a308-a6a670f17016"
level: "task"
title: "Fix code in prd-tree-search: SearchFacets now has three canonical import paths after the prd-tree/index.ts ba (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:03:52.967Z"
completedAt: "2026-04-14T01:13:19.019Z"
acceptanceCriteria: []
description: "- SearchFacets now has three canonical import paths after the prd-tree/index.ts barrel was added without removing tree-search.ts's inline `export type { SearchFacets }`. Remove the inline re-export from tree-search.ts so the single authoritative path is prd-tree/index.ts, which re-exports from search-types.ts.\n- Add unit tests for use-facet-state.ts (initial state, toggle, reset) and search-types.ts (type guard or import-shape assertions). Two of three production files are currently untested, leaving the facet filter contract and type exports unverified. This matches the gap identified for this zone in prior passes but has not yet been acted on."
recommendationMeta: "[object Object]"
---

# Fix code in prd-tree-search: SearchFacets now has three canonical import paths after the prd-tree/index.ts ba (+1 more)

🟠 [completed]

## Summary

- SearchFacets now has three canonical import paths after the prd-tree/index.ts barrel was added without removing tree-search.ts's inline `export type { SearchFacets }`. Remove the inline re-export from tree-search.ts so the single authoritative path is prd-tree/index.ts, which re-exports from search-types.ts.
- Add unit tests for use-facet-state.ts (initial state, toggle, reset) and search-types.ts (type guard or import-shape assertions). Two of three production files are currently untested, leaving the facet filter contract and type exports unverified. This matches the gap identified for this zone in prior passes but has not yet been acted on.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-14T01:03:52.967Z
- **Completed:** 2026-04-14T01:13:19.019Z
- **Duration:** 9m
