---
id: "556e989d-6eee-403a-81d1-2d1cd421d0d5"
level: "feature"
title: "Per-run MCP config is hench runtime state"
status: "pending"
priority: "critical"
tags:
  - "0.7.2"
  - "hench"
  - "run-lifecycle"
source: "ndx-capture"
acceptanceCriteria: []
description: "The per-run MCP config hench writes for Claude-vendor runs (.hench/mcp/&lt;runId&gt;.json, added in 0.7.1 PR J4 #416) must be treated as hench's own runtime state everywhere hench decides what counts as operator work. Observed in a consumer project (caos, run e3fe956f): a successful run was refused completion and its task reset to pending because of this file."
lastModified: "2026-09-25T17:48:49.150Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Discount .hench/mcp/ as hench runtime state in the uncommitted-work gates](./discount-hench-mcp-as-hench-runtime.md) | pending |
