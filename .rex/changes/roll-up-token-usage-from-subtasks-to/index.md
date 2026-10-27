---
id: "61022482-f8de-4c2b-8cc0-78946df52c94"
type: "change"
title: "Roll up token usage from subtasks to tasks, features, and epics"
slug: "roll-up-token-usage-from-subtasks-to"
intent: "Add a rex-side aggregator that walks the PRD tree and sums per-item token usage from hench run data, exposing totals on every node so the dashboard and MCP consumers can read usage at any level without recomputing. Rollups must stay consistent with the single-file PRD invariant and be cheap enough to compute on every dashboard poll."
acceptanceCriteria:
  - "A pure function `aggregateTokenUsage(prd, runs)` returns a map of `itemId -> { self, descendants, total }` token counts"
  - "Totals on a parent equal the sum of its own usage plus all descendant usage, verified by a property-style test on a synthetic tree"
  - "Aggregation handles items with no runs, items archived/pruned, and orphan run entries whose item IDs are no longer in the PRD (orphans reported separately, not silently dropped)"
  - "The aggregator is exposed through the existing rex MCP surface (new tool or extension of `get_prd_status`) and returns in under 50ms on a PRD with 500 items and 5k runs in a benchmark test"
touches:
  - "aa92ccd9-989b-4296-8935-c83c771f34d0"
priority: "high"
tags:
  - "rex"
  - "aggregation"
  - "mcp"
source: "smart-add"
---
