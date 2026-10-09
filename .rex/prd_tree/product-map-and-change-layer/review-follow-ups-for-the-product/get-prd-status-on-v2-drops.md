---
id: "5b52f367-ce20-4eb2-a53e-23293ced070f"
level: "task"
title: "get_prd_status on v2 drops capabilities and open changes under a nested area"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "prdStatusReport counts a capability under an area nested in a top-level area toward a listed area row (or lists the nested area)"
  - "An open change amending a capability under a nested area is counted in some listed area's openChanges"
  - "A unit test in product-report.test.ts with a nested area covers both cases and fails on the current code"
description: "Verdict: should-fix (severity medium). Found by the adversarial review of task 9a441abb.\n\nFailure: `prdStatusReport` (packages/rex/src/core/product-report.ts:194-224) maps every node to its NEAREST area (`areaOf`), but `areas` lists only top-level areas (`tree.product.filter(n => n.type === \"area\")`). No v2 rule forbids an area nested in an area (`layer-nesting` checks only the layer; `area-balance` already treats a nested area as its own area). So for product: A1 (area) → A1.1 (area) → capability X, plus an open change amending X, `get_prd_status` returns `areas: [{ A1, capabilities: 0, openChanges: 0 }]`. X, its status and its open change appear nowhere in the per-area report. The output is silently wrong, not refused.\n\nReachable through rex MCP `get_prd_status` on any v2 tree that nests areas. Not covered: product-report.test.ts only uses single-level areas.\n\nOptions:\n1. Map each node to its top-level area (walk to the root area instead of the nearest one). Cheap, and keeps one row per top-level area. Recommended.\n2. List every area, nested ones included, with a parent reference. This gives a richer shape but changes the output contract."
lastModified: "2026-10-09T02:08:29.256Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
