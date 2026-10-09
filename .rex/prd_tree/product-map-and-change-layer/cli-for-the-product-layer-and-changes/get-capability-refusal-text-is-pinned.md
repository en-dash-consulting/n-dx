---
id: "bffc9f7b-69a9-440c-b28f-32b51b7706c6"
level: "task"
title: "get_capability refusal text is pinned only by a regex, so the 0.9.0 soft freeze on its wording goes unguarded"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T19:29:04.019Z"
completedAt: "2026-10-09T19:31:04.205Z"
endedAt: "2026-10-09T19:31:04.205Z"
resolutionType: "code-change"
resolutionDetail: "Exact-string assertions for get_capability unknown-ref and area refusals in mcp-product-tools.test.ts; rex src unchanged. Commit add4d9d41."
acceptanceCriteria:
  - "handleGetCapability with an unknown id returns exactly `\"nope\" names no product node. Use get_product to see the product layer.` (test)"
  - "handleGetCapability with an area id returns exactly `\"A1\" is an area, not a capability or constraint. Use get_product to see the product layer.` (test)"
  - "No file under packages/rex/src changes"
description: "Verdict: should-fix (low). Found by the adversarial review of fd6301528 (ProductReportError kind + plain).\n\nScenario: core/product-report.ts now builds the MCP refusal as `${plain} Use get_product to see the product layer.` Change `plain` (e.g. drop the trailing period, reword \"names no product node\") or the suffix, and get_capability's text changes. Nothing fails: mcp-product-tools.test.ts:91 checks only /is an area.*get_product/, and product-report.test.ts:78 checks only /names no product node/. The unknown-ref MCP text has no MCP-level test at all.\n\nReachable: every get_capability call with an unknown or non-capability id.\n\nFix: add exact-string assertions in mcp-product-tools.test.ts for the unknown-ref and area refusals (`\"nope\" names no product node. Use get_product to see the product layer.` and `\"A1\" is an area, not a capability or constraint. Use get_product to see the product layer.`). Cost: two assertions; no risk.\n\nDecided (Ryan, 2026-10-09): take the fix as written. Test-only: add the two exact-string assertions; do not change packages/rex/src (the point is to pin today's MCP text, not to edit it). If an assertion fails against the current text, stop and report the actual text instead of editing source to match."
lastModified: "2026-10-09T19:31:04.481Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
