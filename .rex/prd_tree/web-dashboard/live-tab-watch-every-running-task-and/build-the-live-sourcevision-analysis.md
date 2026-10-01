---
id: "da9227aa-3b7a-449f-80af-a99f94975c1a"
level: "task"
title: "Build the live sourcevision analysis page: phases, enrichment passes, estimate, output and model spend"
status: "in_progress"
priority: "high"
tags:
  - "live"
  - "web-viewer"
  - "sourcevision"
blockedBy:
  - "a8335123-473d-41cf-9be4-3bce15ee13be"
  - "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
startedAt: "2026-10-01T06:23:50.798Z"
acceptanceCriteria:
  - "The current phase, pass and batch update within 2 seconds of each change for terminal- and dashboard-started analyses."
  - "Each phase shows its time against the previous run of the same mode, and the estimate is hidden when there is no previous run."
  - "Stop works for both kinds of start and leaves the manifest in a state the next analyze accepts."
  - "A failed or stopped analysis shows which phase it stopped in and the error line."
description: "New view at `/live/analyze` fed by the structured analyze progress. Header: product tile, route with start time and the command that was run, title by mode (fast, deep), chips (running and elapsed, estimate from the previous run of the same mode, worktree, started from dashboard or terminal, enrichment vendor and model, cost so far), Copy link and Stop analysis (existing `POST /api/commands/sv-analyze/stop` for dashboard runs; stop by pid otherwise). An overall six-segment bar labelled Inventory, Imports, Classifications, Zones, Components, Call graph. Phase list: each phase with what it does, its result once done (files and languages, import edges, archetypes, zone count), its time now and last time; Zones expands into enrichment passes 0 to 4 with the current pass's batch progress and cache reuse; Call graph marked optional (a failure there does not fail the run). Output: the stdout tail with follow. Side column: model calls by task class (calls, tokens, time) and judgment-cache reuse; which `.sourcevision/` files have been written (from `manifest.modules`); notes while it runs (analysis pages show the previous run until this finishes; hold `ndx ci` and `ndx refresh`, which also write `.sourcevision/`); a note about background narration for escalated zones; recent analyses from `analyses.jsonl`. When the run finishes, say so and link to the Analysis stage. Show only one analyze per worktree; other worktrees' analyses get their own entry in the running-now bar."
lastModified: "2026-10-01T06:23:51.182Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
