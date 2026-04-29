---
id: "4db98642-d2a7-4b4b-b74b-fcf66b0c9928"
level: "task"
title: "Sourcevision Short Alias"
status: "completed"
source: "smart-add"
startedAt: "2026-02-05T17:06:14.761Z"
completedAt: "2026-02-05T17:06:14.761Z"
acceptanceCriteria: []
description: "Provide 'sv' as a short alias for sourcevision in all contexts"
---

## Subtask: Add sv standalone binary

**ID:** `45541378-5da7-41db-bdaa-a747095ca4a8`
**Status:** completed
**Priority:** medium

Create sv binary that delegates to sourcevision commands

**Acceptance Criteria**

- sv analyze works identically to sourcevision analyze
- sv works without any prefix
- All sourcevision subcommands work with sv

---

## Subtask: Support sv with prefixes

**ID:** `72f8572e-2bf9-45c7-8587-5f515b466f9d`
**Status:** completed
**Priority:** medium

Enable both 'n-dx sv' and 'ndx sv' command patterns

**Acceptance Criteria**

- n-dx sv analyze works
- ndx sv analyze works
- sv maintains existing alias functionality

---
