---
id: "12988943-359c-4482-81f1-29237a3a19ae"
level: "task"
title: "Give saved run settings a home in the v2 schema"
status: "pending"
priority: "high"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "761ab00d-e31b-4e8a-9c86-a4bde4584471"
source: "roadmap"
acceptanceCriteria:
  - "run is an optional intent field on task and change in the v2 schema, validated by the same rules as v1"
  - "A v1 item with a run block maps to a v2 task or change with the same block (test)"
  - "The intent/state table in the v2 schema module lists run under intent"
description: "Prepare task phase 2 (#537) adds a run block of saved run settings to v1 items (model, provider, permissionMode, review, reviewModel, reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes). The v2 schema has no place for it, and the schema freezes at 1.0.0. Add run as an intent field (frontmatter) on tasks and on changes, since a task-less change is itself a unit of work; validate it with the shared validateRunSettings from rex rather than a second copy; and map the v1 field across in the dual-read parser's expectations."
lastModified: "2026-10-06T16:54:40.321Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
