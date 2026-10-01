---
id: "a8335123-473d-41cf-9be4-3bce15ee13be"
level: "task"
title: "Expose structured sourcevision analyze progress: phase, enrichment pass, batch and model calls"
status: "pending"
priority: "high"
tags:
  - "live"
  - "sourcevision"
  - "web-server"
acceptanceCriteria:
  - "During a deep analyze the dashboard knows the current phase, pass and batch within 2 seconds of each change, whether the run was started from a terminal or the dashboard."
  - "The status response keeps every existing field; the progress object is additive."
  - "The progress file never survives as 'running' after the process exits (stale detection by pid)."
  - "Per-phase timings of the previous run of the same mode are returned with the progress."
  - "Changeset for @n-dx/sourcevision and @n-dx/web (patch)."
description: "`sv analyze` runs six phases in order (`packages/sourcevision/src/cli/commands/analyze.ts`): inventory, imports, classifications, zones, components, callgraph (callgraph is non-critical). Phase 4 runs enrichment passes 0 to 4 (`analyzers/enrich-config.ts`: heuristic; zone naming and initial observations; cross-zone relationships; anti-patterns; suggestions and risk areas). Progress today is only `[phase N]` stdout lines plus `manifest.modules[*].status`, and `analyses.jsonl` is appended only at the end of the run. Write a small progress file under `.sourcevision/.cache/` that analyze updates as it moves: mode, start time, current phase index and name, per-phase start and end, current pass and its batch k of n, judgment-cache hits and misses, and LLM calls, tokens and duration per task class so far. Delete or mark it finished at the end. In the web server, read that file for both terminal- and dashboard-started runs, add it as a structured field to `GET /api/commands/sv-analyze/status` (keeping `recentOutput`), and push a WebSocket frame when it changes. Include the previous run of the same mode's per-phase timings from `analyses.jsonl` so the viewer can show \"last time\" and an estimate."
lastModified: "2026-10-01T00:18:44.829Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
