---
id: "901a3775-37cc-42e1-bf80-c9d5e9cf5a6f"
level: "task"
title: "The Product, Changes and capability views show real v2 data"
status: "pending"
priority: "critical"
tags:
  - "pr-36"
  - "lane-web"
  - "web"
blockedBy:
  - "0811a096-cbfb-45b9-ad81-25663c438959"
acceptanceCriteria:
  - "The PR 14 views (packages/web/src/viewer/views/product*.ts) are routed and fed from rex's v2 model through a server route, not fixtures (test)"
  - "On a v1 project they show an empty state naming ndx migrate (test)"
description: "Route the PR 14 views (packages/web/src/viewer/views/product.ts, product-model.ts and the capability view) and feed them from rex's v2 model (loadPrdModel through the gateway) via a server route, not fixtures. On a v1 project they show an empty state naming `ndx migrate`.\n\nDesign boundary (roadmap PR 36, D1; every change is checked against it):\n- packages/web only (src and tests), following packages/web/AGENTS.md: the server → viewer layering, the gateway rules (all rex imports through packages/web/src/server/rex-gateway.ts, re-export only, type imports too), and the web→rex gateway export ceiling in tests/e2e/architecture-policy.test.js raised with a \"Raised from X to Y for …\" description entry (plus tests/integration/cross-package-contracts.test.js if it lists the gateway's exports). The viewer reaches server data only through routes, never by importing rex.\n- Not rex, not hench. Consume rex's public API only (packages/rex/src/public.ts as exported by roadmap PR 34 T6: prdLayout, loadPrdModel, findNextWork, completeV2Work, ChangeLayerStore, buildChangeBrief, …; on a v2 tree resolveStore already returns the change-layer store since PR 33). If something web needs is not exported by rex, stop and report it rather than editing rex.\n- v1 projects keep today's behaviour exactly.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy to a temp dir before anything writes).\n- Add a patch changeset for @n-dx/web. Never major. Any field added to an /api route on v2 is listed in the changeset.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold. D6 of the v2 Migration Path: the dashboard gets the no-break minimum; full type-aware CRUD, Quick Add preview and Prepare task on v2 stay in roadmap PR 21."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T11:09:48.810Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
