---
id: "e0f4567a-1b58-41af-83aa-aecc65adcd95"
type: "change"
title: "The Product and Changes views stay stale after a PRD change until the page is reloaded"
slug: "the-product-and-changes-views-stay"
intent: "Verdict: should-fix (adversarial review of 901a3775). Scenario: on a v2 project, open Plan with the Product and Changes sections mounted, then Quick Add a change (or let `ndx work` complete/apply one). The server broadcasts `rex:prd-changed` and the Tasks tree refreshes, but `ProductPage`/`ChangesPage` (packages/web/src/viewer/views/product-pages.ts, `useProductRead`) fetch once on mount and never refetch, so the new change is missing from Changes and capability status/overlays stay stale beside a Tasks tree that shows the new state. Reachable from the dashboard on every v2 write. Options: (a) refetch in `useProductRead` on `rex:prd-changed` through the existing `use-prd-websocket` hook / ws pipeline (small; recommended, matches how the Tasks view stays live); (b) poll with `usePolling` (simpler, but adds load and latency). Risk: refetch storms during bulk writes; the ws pipeline already coalesces frames."
acceptanceCriteria:
  - "After a rex:prd-changed frame, the mounted Product page refetches GET /api/rex/product and renders the new data (viewer test)"
  - "After a rex:prd-changed frame, the mounted Changes page refetches GET /api/rex/changes and lists a change added since mount (viewer test)"
  - "An open capability page refetches its capability on rex:prd-changed"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-36"
  - "web"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
---
