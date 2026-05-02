---
id: "34344b18-f2a4-43d0-822c-27c7d2e97837"
level: "task"
title: "Attribute hench run token usage to the active PRD task"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "telemetry"
source: "smart-add"
startedAt: "2026-04-23T15:38:24.782Z"
completedAt: "2026-04-23T15:50:43.494Z"
resolutionType: "code-change"
resolutionDetail: "Added RunTokens `{input, output, cached, total}` schema + normalizeRunTokens() helper. saveRun() auto-stamps the tuple on every write so failed/aborted/zero-usage runs all persist joinable totals. Added store/run-token-index.ts with listCompletedRunTokens() returning {runId, itemId, tokens, status, finishedAt} tuples for every terminal-state run — reads structured run JSON only, no transcript parsing. Exposed via public.ts. Extended Zod validator to accept the tokens field and the previously-missing 'cancelled' run status. Added 11 unit tests covering task ID, subtask ID, aborted mid-loop (cancelled + failed), zero usage, legacy-record fallback, and multi-status filtering."
acceptanceCriteria:
  - "Each entry written under `.hench/runs/` includes the rex item ID the run targeted and an aggregated token-usage object (input, output, cached, total)"
  - "A rex/hench gateway helper returns `{ itemId, tokens }` tuples for all completed runs without re-parsing transcripts on every call"
  - "Runs that fail or are aborted still record whatever usage was consumed so rollups are not silently undercounted"
  - "Unit tests cover: run with a task ID, run with a subtask ID, run aborted mid-loop, and run with zero usage"
description: "Extend the hench run recorder to stamp each run with the rex task/subtask ID it executed against and persist per-run token totals (input, output, cached, total) in a form that can be joined back to the PRD. Today `.hench/runs/` captures usage per run but there is no durable link from a run to the specific PRD item, which blocks any per-task or per-feature rollup."
---

# Attribute hench run token usage to the active PRD task

🟠 [completed]

## Summary

Extend the hench run recorder to stamp each run with the rex task/subtask ID it executed against and persist per-run token totals (input, output, cached, total) in a form that can be joined back to the PRD. Today `.hench/runs/` captures usage per run but there is no durable link from a run to the specific PRD item, which blocks any per-task or per-feature rollup.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, rex, telemetry
- **Level:** task
- **Started:** 2026-04-23T15:38:24.782Z
- **Completed:** 2026-04-23T15:50:43.494Z
- **Duration:** 12m
