---
id: "12e7cfc8-0007-43bf-a0f4-d28b0825e3e1"
level: "task"
title: "Expand Rex into a full multi-view section"
status: "completed"
priority: "high"
tags:
  - "web"
  - "rex"
  - "views"
startedAt: "2026-02-09T18:18:11.954Z"
completedAt: "2026-02-09T18:18:11.954Z"
acceptanceCriteria: []
description: "Rex currently has a single \"Tasks\" tab that crams the PRD tree, add-item form, analysis trigger, and bulk actions into one view. Break this out into multiple views that give Rex proper treatment: a PRD dashboard/overview, the task tree, validation, and analysis/proposals. Move Token Usage and Validation under Rex since they're Rex concerns."
---

## Subtask: Add Rex Dashboard view with PRD status overview

**ID:** `19741884-c9a4-46bb-905c-a8aca5d4fe43`
**Status:** completed
**Priority:** high

Create a new rex-dashboard view that serves as the landing page for the Rex section. Should show: overall PRD completion stats (total/completed/pending/blocked/deferred), per-epic progress bars with completion percentages, priority distribution, and a "next task" highlight. This gives Rex a proper entry point beyond just the raw task tree. Use metric cards and progress bars consistent with existing component style.

---

## Subtask: Extract Analysis/Proposals into its own Rex view

**ID:** `2048ebbf-fa7c-44ed-8929-32d16aa7aa49`
**Status:** completed
**Priority:** medium

Currently the Analyze button and proposal review UI are embedded in the PRD/Tasks view. Extract this into a dedicated "Analysis" view within the Rex section. Shows: trigger analysis button, pending proposals list with accept/reject, analysis history. This declutters the task tree view and gives the analysis pipeline its own space.

---

## Subtask: Move Validation and Token Usage views under Rex section

**ID:** `41001195-4568-4ca6-9bbc-37c23c970670`
**Status:** completed
**Priority:** medium

Validation (PRD integrity checks, dependency graph, blocking chains) and Token Usage (API consumption tracking across rex/hench/sourcevision) are both operational concerns that belong under Rex. Move both from the general Analysis section into the Rex section in the sidebar. View implementations stay the same — this is purely a navigation reorganization.

---
