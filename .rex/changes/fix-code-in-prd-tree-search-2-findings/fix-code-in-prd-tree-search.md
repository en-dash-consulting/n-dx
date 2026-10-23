---
id: "f6ad260e-dd40-4e7f-a308-a6a670f17016"
type: "task"
title: "Fix code in prd-tree-search: SearchFacets now has three canonical import paths after the prd-tree/index.ts ba (+1 more)"
slug: "fix-code-in-prd-tree-search"
description: "- SearchFacets now has three canonical import paths after the prd-tree/index.ts barrel was added without removing tree-search.ts's inline `export type { SearchFacets }`. Remove the inline re-export from tree-search.ts so the single authoritative path is prd-tree/index.ts, which re-exports from search-types.ts.\n- Add unit tests for use-facet-state.ts (initial state, toggle, reset) and search-types.ts (type guard or import-shape assertions). Two of three production files are currently untested, leaving the facet filter contract and type exports unverified. This matches the gap identified for this zone in prior passes but has not yet been acted on."
priority: "high"
source: "sourcevision"
---
