---
id: "8e5fab27-da11-4b09-ade5-a81ddbc539bc"
level: "task"
title: "Quick Add creates a change on v2"
status: "pending"
priority: "critical"
tags:
  - "pr-36"
  - "lane-web"
  - "web"
blockedBy:
  - "901a3775-37cc-42e1-bf80-c9d5e9cf5a6f"
acceptanceCriteria:
  - "POST /api/rex/items on a v2 project creates an Inbox change through rex (test)"
  - "Status PATCH works on a v2 task (test)"
description: "POST /api/rex/items on a v2 project creates an Inbox change through rex (the same path `rex add` / MCP add_item take on v2; a level is not required and not accepted as a v2 type). Status PATCH on a v2 task goes through rex's v2 completion (completeV2Work) for completed and through the change-layer store otherwise. v1 routes are unchanged. Full type-aware CRUD and the Quick Add preview stay in roadmap PR 21.\n\nDesign boundary (roadmap PR 36, D1; every change is checked against it):\n- packages/web only (src and tests), following packages/web/AGENTS.md: the server → viewer layering, the gateway rules (all rex imports through packages/web/src/server/rex-gateway.ts, re-export only, type imports too), and the web→rex gateway export ceiling in tests/e2e/architecture-policy.test.js raised with a \"Raised from X to Y for …\" description entry (plus tests/integration/cross-package-contracts.test.js if it lists the gateway's exports). The viewer reaches server data only through routes, never by importing rex.\n- Not rex, not hench. Consume rex's public API only (packages/rex/src/public.ts as exported by roadmap PR 34 T6: prdLayout, loadPrdModel, findNextWork, completeV2Work, ChangeLayerStore, buildChangeBrief, …; on a v2 tree resolveStore already returns the change-layer store since PR 33). If something web needs is not exported by rex, stop and report it rather than editing rex.\n- v1 projects keep today's behaviour exactly.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy to a temp dir before anything writes).\n- Add a patch changeset for @n-dx/web. Never major. Any field added to an /api route on v2 is listed in the changeset.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold. D6 of the v2 Migration Path: the dashboard gets the no-break minimum; full type-aware CRUD, Quick Add preview and Prepare task on v2 stay in roadmap PR 21."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T11:09:49.804Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
