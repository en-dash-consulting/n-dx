---
id: "46e9648a-b652-4da8-9655-cc1da05e9aba"
type: "change"
title: "Fix code in prd-tree-search (2 findings)"
slug: "fix-code-in-prd-tree-search-2-findings"
intent: "- SearchFacets now has three canonical import paths after the prd-tree/index.ts barrel was added without removing tree-search.ts's inline `export type { SearchFacets }`. Remove the inline re-export from tree-search.ts so the single authoritative path is prd-tree/index.ts, which re-exports from search-types.ts.\n- Add unit tests for use-facet-state.ts (initial state, toggle, reset) and search-types.ts (type guard or import-shape assertions). Two of three production files are currently untested, leaving the facet filter contract and type exports unverified. This matches the gap identified for this zone in prior passes but has not yet been acted on."
touches:
  - "56f47d3d-d39d-4938-9923-b3735656ba7b"
priority: "high"
source: "sourcevision"
---
