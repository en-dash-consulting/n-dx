---
id: "34344b18-f2a4-43d0-822c-27c7d2e97837"
type: "change"
title: "Attribute hench run token usage to the active PRD task"
slug: "attribute-hench-run-token-usage-to-the"
intent: "Extend the hench run recorder to stamp each run with the rex task/subtask ID it executed against and persist per-run token totals (input, output, cached, total) in a form that can be joined back to the PRD. Today `.hench/runs/` captures usage per run but there is no durable link from a run to the specific PRD item, which blocks any per-task or per-feature rollup."
acceptanceCriteria:
  - "Each entry written under `.hench/runs/` includes the rex item ID the run targeted and an aggregated token-usage object (input, output, cached, total)"
  - "A rex/hench gateway helper returns `{ itemId, tokens }` tuples for all completed runs without re-parsing transcripts on every call"
  - "Runs that fail or are aborted still record whatever usage was consumed so rollups are not silently undercounted"
  - "Unit tests cover: run with a task ID, run with a subtask ID, run aborted mid-loop, and run with zero usage"
touches:
  - "aa92ccd9-989b-4296-8935-c83c771f34d0"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "telemetry"
source: "smart-add"
---
