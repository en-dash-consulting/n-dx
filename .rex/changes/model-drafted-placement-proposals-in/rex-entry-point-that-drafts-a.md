---
id: "c4fbfee6-6191-43d7-ade2-bee8a9df2a63"
type: "task"
title: "Rex entry point that drafts a placement for an existing change without writing"
slug: "rex-entry-point-that-drafts-a"
description: "Expose from @n-dx/rex's public entry point a function that runs `placeChange` (`core/placement.ts`) for an existing open change with the configured `prd.place` text model (`analyze/place-reason.ts`) and the live areas, and returns `{ shortlist, pick?, proposal?, warnings }` without touching the tree. Reuse the model seam and area list the capture path builds; do not read config outside the existing settings loaders (`loadPlacementSettings`). A proposal under an unknown area is dropped with a warning, as `placeChange` already does."
acceptanceCriteria:
  - "The draft function is exported from @n-dx/rex and returns shortlist, pick or proposal, and warnings"
  - "It never writes the tree"
  - "Unit tests with a stub model cover a pick, a proposal, a proposal under an unknown area and a model error"
priority: "low"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
