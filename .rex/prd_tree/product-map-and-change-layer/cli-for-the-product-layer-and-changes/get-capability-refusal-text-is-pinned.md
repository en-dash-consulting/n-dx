---
id: "bffc9f7b-69a9-440c-b28f-32b51b7706c6"
level: "task"
title: "get_capability refusal text is pinned only by a regex, so the 0.9.0 soft freeze on its wording goes unguarded"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "handleGetCapability with an unknown id returns exactly `\"nope\" names no product node. Use get_product to see the product layer.` (test)"
  - "handleGetCapability with an area id returns exactly `\"A1\" is an area, not a capability or constraint. Use get_product to see the product layer.` (test)"
description: "Verdict: should-fix (low). Found by the adversarial review of fd6301528 (ProductReportError kind + plain).\n\nScenario: core/product-report.ts now builds the MCP refusal as `${plain} Use get_product to see the product layer.` Change `plain` (e.g. drop the trailing period, reword \"names no product node\") or the suffix, and get_capability's text changes. Nothing fails: mcp-product-tools.test.ts:91 checks only /is an area.*get_product/, and product-report.test.ts:78 checks only /names no product node/. The unknown-ref MCP text has no MCP-level test at all.\n\nReachable: every get_capability call with an unknown or non-capability id.\n\nFix: add exact-string assertions in mcp-product-tools.test.ts for the unknown-ref and area refusals (`\"nope\" names no product node. Use get_product to see the product layer.` and `\"A1\" is an area, not a capability or constraint. Use get_product to see the product layer.`). Cost: two assertions; no risk."
lastModified: "2026-10-09T17:51:18.709Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
