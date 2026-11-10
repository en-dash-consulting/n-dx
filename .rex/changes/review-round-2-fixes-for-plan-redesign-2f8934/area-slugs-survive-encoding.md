---
id: "37c23e84-f744-41b1-a139-d3738bfa23c2"
type: "task"
title: "Area slugs survive encoding"
slug: "area-slugs-survive-encoding"
description: "Stack review round 2 finding on #980 at packages/web/src/viewer/route-state.ts:40 (review comment 4494324957).\n\n**Should fix: the area slug is never encoded or decoded**\n\nThe capability id is encoded and decoded, but the slug is not. `areaPath` builds the raw `/product/area/${slug}` (area.ts:29), and `areaSlugOfTab` returns the slug exactly as it appears in `location.pathname`. Rex's `slugify` produces only `[a-z0-9-]`, but the writer's `assertSlug` accepts a hand-authored slug like `café` or `my area`. Such an area opens fine in session. On reload, though, the tab reads `caf%C3%A9`, the fetch double-encodes it, and the page shows \"Could not load the area: not found\". A `#` or `?` in a slug breaks the URL outright.\n\nFix: `encodeURIComponent` the slug in `areaPath` and in view-registry's `tab: \\`area/${slug}\\``. Decode it in `areaSlugOfTab` with the same try/catch guard. Add a non-ASCII route-state test. The same code is still at S8."
acceptanceCriteria:
  - "areaPath (area.ts) and view-registry's tab area/${slug} encode the slug with encodeURIComponent"
  - "areaSlugOfTab decodes it with the same try/catch guard as the capability id, returning null on a malformed slug"
  - "A route-state test with a non-ASCII area slug round-trips"
---
