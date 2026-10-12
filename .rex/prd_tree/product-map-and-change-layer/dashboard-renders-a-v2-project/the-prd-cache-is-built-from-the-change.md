---
id: "0811a096-cbfb-45b9-ad81-25663c438959"
level: "task"
title: "The PRD cache is built from the change-layer projection on v2"
status: "completed"
priority: "critical"
tags:
  - "pr-36"
  - "lane-web"
  - "web"
startedAt: "2026-10-12T11:09:57.410Z"
completedAt: "2026-10-12T11:22:49.466Z"
endedAt: "2026-10-12T11:22:49.466Z"
resolutionType: "code-change"
resolutionDetail: "v2 cache built from resolveStore projection; prdExists/mtime/watcher cover product/ and changes/; gateway +prdLayout (ceiling 78→79)."
acceptanceCriteria:
  - "On a v2 project, ndx start's PRD cache refresh (packages/web/src/server/start.ts refreshPRDCache, prd-io.ts prdExists) builds .rex/.cache/prd.json from rex's change-layer projection via packages/web/src/server/rex-gateway.ts (test)"
  - "The task list, Live and the merge graph show titles, not 'No PRD data found' (test)"
  - "On v1 nothing changes"
description: "On a v2 project, `ndx start`'s PRD cache refresh (packages/web/src/server/start.ts refreshPRDCache, packages/web/src/server/prd-io.ts prdExists) builds .rex/.cache/prd.json from rex's change-layer projection (the change-layer store resolveStore returns on v2, through packages/web/src/server/rex-gateway.ts), and the tree watcher refreshes it when product/ or changes/ change, so the task list, Live and the merge graph show titles instead of \"No PRD data found\". prdExists is true for a v2 tree. On v1 nothing changes.\n\nDesign boundary (roadmap PR 36, D1; every change is checked against it):\n- packages/web only (src and tests), following packages/web/AGENTS.md: the server → viewer layering, the gateway rules (all rex imports through packages/web/src/server/rex-gateway.ts, re-export only, type imports too), and the web→rex gateway export ceiling in tests/e2e/architecture-policy.test.js raised with a \"Raised from X to Y for …\" description entry (plus tests/integration/cross-package-contracts.test.js if it lists the gateway's exports). The viewer reaches server data only through routes, never by importing rex.\n- Not rex, not hench. Consume rex's public API only (packages/rex/src/public.ts as exported by roadmap PR 34 T6: prdLayout, loadPrdModel, findNextWork, completeV2Work, ChangeLayerStore, buildChangeBrief, …; on a v2 tree resolveStore already returns the change-layer store since PR 33). If something web needs is not exported by rex, stop and report it rather than editing rex.\n- v1 projects keep today's behaviour exactly.\n- Fixtures: packages/rex/tests/fixtures/v2-tree (copy to a temp dir before anything writes).\n- Add a patch changeset for @n-dx/web. Never major. Any field added to an /api route on v2 is listed in the changeset.\n\nDecisions (assumed overnight 2026-10-12, Ryan to confirm): stack A's Q1–Q4 hold. D6 of the v2 Migration Path: the dashboard gets the no-break minimum; full type-aware CRUD, Quick Add preview and Prepare task on v2 stay in roadmap PR 21.\n\nPrevious attempt (run f90906d7, 2026-10-12): the work landed in commit 37f5f63bc, but the test gate failed on tests/e2e/wall-clock-inventory-policy.test.js: packages/web/tests/integration/start-cache-v2.test.ts bounds a clock reading and has no row in tests/wall-clock-assertion-inventory.md. Prefer rewriting that test so its verdict does not depend on a clock (TESTING.md, Family 2, technique 1: count the work, or compare mtimes you set yourself with fs.utimes). Only if a clock is genuinely required, follow the inventory procedure. Run the six root policy tests before finishing."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T11:22:49.733Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
