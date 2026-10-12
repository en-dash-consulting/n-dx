---
id: "d1dc7f68-d08f-4377-a30a-0394a135bc62"
level: "task"
title: "ensureLegacyPrdMigrated scaffolds prd_tree/ beside product/ when a v2 tree keeps a stray prd.json"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-33"
  - "lane-rex-store"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "ensureLegacyPrdMigrated on a copy of the v2 fixture with a valid .rex/prd.json creates no prd_tree/ and leaves prd.json untouched (test)"
  - "Its result names the v2 layout as the reason it skipped (test)"
  - "v1 legacy migration behaviour is unchanged: existing ensure-legacy-prd-migrated tests pass unedited"
description: "Found by the adversarial review of 74584d30. Verdict: out-of-scope for that change (the code predates it), but it belongs to this feature's goal that no tool can split a v2 tree.\n\nFailure scenario: take a v2 project (`product/` present) that still has a legacy `.rex/prd.json` and no `prd.json.migrated` marker, for example one copied in or restored by hand. Any `rex status`, `tree`, `next`, `add`, `update` or `remove`, starting an MCP session (mcp-workspace.ts:53) or starting the web server (web/src/server/start.ts:1095) calls `ensureLegacyPrdMigrated`. It writes that JSON to `.rex/prd_tree/` beside `product/`. Evidence: packages/rex/src/store/ensure-legacy-prd-migrated.ts:138-197 checks for the marker, `prd.json`, `prd_tree/` and branch files, but never the layout.\n\nReachability: real entry points, but only with a stray legacy file. After 74584d30 the stray tree is inert, because FileStore refuses a v2 tree and resolveStore serves the change layer. So the result is a confusing directory, not a wrong answer.\n\nFix options:\n(a) Return `{ migrated: false, reason: \"v2-layout\" }` when `prdLayout(rexDir) === \"v2\"`, before Step 2. This extends the reason union. It is cheap, and the risk is low. Recommended.\n(b) Have callers skip the call on v2. This spreads the check over about 14 call sites. Not recommended."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T07:25:49.793Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
