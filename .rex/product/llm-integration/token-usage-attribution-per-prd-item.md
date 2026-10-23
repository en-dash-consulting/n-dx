---
id: "aa92ccd9-989b-4296-8935-c83c771f34d0"
type: "capability"
title: "Token Usage Attribution per PRD Item"
slug: "token-usage-attribution-per-prd-item"
statement: "n-dx attributes the LLM token usage of each hench run to the PRD item the run worked on and rolls those totals up the PRD tree, so every task, feature and epic exposes its own usage."
criteria: [{"id":"c1","text":"When hench records a run under `.hench/runs/`, hench shall store the rex item ID the run targeted together with an aggregated token-usage object of input, output, cached and total tokens."},{"id":"c2","text":"The rex/hench gateway shall return `{ itemId, tokens }` tuples for all completed runs without re-parsing run transcripts on each call."},{"id":"c3","text":"If a run fails or is aborted, hench shall still record the token usage the run consumed."},{"id":"c4","text":"The rex aggregator `aggregateTokenUsage(prd, runs)` shall return a map of each item ID to its `self`, `descendants` and `total` token counts."},{"id":"c5","text":"The rex aggregator shall set each parent item's total to the sum of its own usage and the usage of all its descendants."},{"id":"c6","text":"When an item has no runs, the rex aggregator shall still return an entry for that item."},{"id":"c7","text":"If a run's item ID is no longer in the PRD, the rex aggregator shall report that run as an orphan separately from the per-item totals."},{"id":"c8","text":"The rex MCP server shall expose the aggregated per-item token usage to MCP clients."},{"id":"c9","text":"The rex aggregator shall return its result in under 50ms for a PRD of 500 items and 5,000 runs."}]
source: "smart-add"
---

Capture and aggregate LLM token usage (input, output, cached, total) against the PRD item each hench run is working on, then roll those totals up the tree so tasks, features, and epics each expose their own usage.
