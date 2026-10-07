---
id: "12988943-359c-4482-81f1-29237a3a19ae"
level: "task"
title: "Give saved run settings a home in the v2 schema"
status: "in_progress"
priority: "high"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "761ab00d-e31b-4e8a-9c86-a4bde4584471"
  - "c3303c54-9650-4875-8353-d3d7d6875bbc"
source: "roadmap"
startedAt: "2026-10-07T16:16:07.488Z"
acceptanceCriteria:
  - "run is declared on task and change intent as a loose object whose known keys come from RUN_SETTING_KEYS"
  - "A malformed or newer-version run block on one task round-trips unchanged with a warning, and every other PRD write still succeeds (regression test)"
  - "Writers reject an invalid run block with validateRunSettings's message (test per writer path that exists in v2)"
  - "A v1 task with a run block maps to a v2 task with the same block (test)"
description: "Prepare task phase 2 (#537, decision TP15) adds a run block of saved run settings to v1 tasks: how ndx work should run that task, honoured by the CLI and the dashboard. It is authored intent, so it belongs in the intent front matter, not state.yaml. Take the key set from rex's RUN_SETTING_KEYS rather than copying it (today: tier, models per vendor, provider, permissionMode, review, reviewTier, reviewModels, reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes); an empty {} is never written.\n\nValidation contract, keep it from v1: declare run as a loose object in the intent schema, and validate strictly only at writers (MCP add_item and edit_item, rex update --run, the dashboard save route) with validateRunSettings. Never put the strict schema inside whole-document validation: an early v1 draft did, and one malformed run block then blocked every PRD write in the workspace, including hench's completion writes, and a newer ndx adding a key would lock older versions out the same way.\n\nLevel: tasks, and changes, because under v2 a change with no tasks is itself the unit of work hench runs (decision B5). Subtasks are sections of a task and carry none.\n\nNeeds #537 merged first (RunSettings, RUN_SETTING_KEYS and validateRunSettings come from it)."
lastModified: "2026-10-07T16:16:07.710Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
