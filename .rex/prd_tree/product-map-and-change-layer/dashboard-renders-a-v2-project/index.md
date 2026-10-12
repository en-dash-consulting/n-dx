---
id: "e1a26302-7d80-46d4-9002-45e25119ba34"
level: "feature"
title: "Dashboard renders a v2 project"
status: "pending"
priority: "critical"
tags:
  - "product-map"
  - "pr-36"
  - "lane-web"
  - "web"
blockedBy:
  - "b86f9199-bd84-45e8-95a8-bad39e42ebeb"
acceptanceCriteria: []
description: "Roadmap PR 36 (v2 Migration Path, card D1), based on roadmap PR 35 (feature be394022). On a v2 project the dashboard reads an empty v1 cache and shows \"No PRD data found\"; Quick Add and status PATCH fail with ENOENT; the PR 14 Product, Changes and capability views are built but only rendered from fixtures. This feature builds the PRD cache from rex's change-layer projection, routes the Product, Changes and capability views to real v2 data, and makes Quick Add create an Inbox change and status PATCH work on v2.\n\nThis is the no-break subset of Hal's feature 89ecd7f3 (\"Dashboard on the v2 model\"); Ryan owns this work by decision D7 of the v2 Migration Path (2026-10-12).\n\nDesign boundary (roadmap PR 36, D1; every change is checked against it):\n- packages/web only (src and tests), following packages/web/AGENTS.md: the server → viewer layering, the gateway rules (all rex imports through packages/web/src/server/rex-gateway.ts, re-export only, type imports too), and the web→rex gateway export ceiling in tests/e2e/architecture-policy.test.js raised with a \"Raised from X to Y for …\" description entry (plus tests/integration/cross-package-contracts.test.js if it lists the gateway's exports). The viewer reaches server data only through routes, never by importing rex.\n- Not rex, not hench. Consume rex's public API only (packages/rex/src/public.ts as exported by roadmap PR 34 T6: prdLayout, loadPrdModel, findNextWork, completeV2Work, ChangeLayerStore, buildChangeBrief, …; on a v2 tree resolveStore already returns the change-layer store since PR 33). If something web needs is not exported by rex, stop and report it rather than editing rex.\n- v1 projects keep today's behaviour exactly.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy to a temp dir before anything writes).\n- Add a patch changeset for @n-dx/web. Never major. Any field added to an /api route on v2 is listed in the changeset.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold. D6 of the v2 Migration Path: the dashboard gets the no-break minimum; full type-aware CRUD, Quick Add preview and Prepare task on v2 stay in roadmap PR 21."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T11:09:46.829Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A v2 PATCH that both completes and edits a field must not half-apply](./a-v2-patch-that-both-completes-and.md) | pending |
| [Bulk status PATCH completes v2 work without rex's v2 completion](./bulk-status-patch-completes-v2-work.md) | completed |
| [Dashboard misses v2 edits under changes/ when it was created after ndx start](./dashboard-misses-v2-edits-under.md) | completed |
| [ndx start on a v2 tree with a stray prd.json creates no prd_tree/](./ndx-start-on-a-v2-tree-with-a-stray.md) | pending |
| [POST /api/rex/restore and GET /api/rex/backups refuse on a v2 project](./post-api-rex-restore-and-get-api-rex.md) | pending |
| [Quick Add creates a change on v2](./quick-add-creates-a-change-on-v2.md) | completed |
| [The PRD cache is built from the change-layer projection on v2](./the-prd-cache-is-built-from-the-change.md) | completed |
| [The Product, Changes and capability views show real v2 data](./the-product-changes-and-capability.md) | pending |
| [The v2 refusal of parentId says what to do instead](./the-v2-refusal-of-parentid-says-what.md) | pending |
| [The dashboard's merge route and refinement merge follow the v2 change-layer merge rules](./the-dashboard-s-merge-route-and.md) | pending |
