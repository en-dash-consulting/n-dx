---
id: "556e989d-6eee-403a-81d1-2d1cd421d0d5"
type: "change"
title: "Per-run MCP config is hench runtime state"
slug: "per-run-mcp-config-is-hench-runtime"
intent: "The per-run MCP config hench writes for Claude-vendor runs (.hench/mcp/&lt;runId&gt;.json, added in 0.7.1 PR J4 #416) must be treated as hench's own runtime state everywhere hench decides what counts as operator work. Observed in a consumer project (caos, run e3fe956f): a successful run was refused completion and its task reset to pending because of this file."
touches:
  - "03266251-06ef-4864-960a-0cb02986ff1d"
plannedRelease: "0.7.2"
priority: "critical"
tags:
  - "0.7.2"
  - "hench"
  - "run-lifecycle"
source: "ndx-capture"
---
