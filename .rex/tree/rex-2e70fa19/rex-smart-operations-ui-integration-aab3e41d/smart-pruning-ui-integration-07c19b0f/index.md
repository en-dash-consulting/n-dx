---
id: "07c19b0f-f2f0-40d7-a6e5-3da7354e9bbd"
level: "task"
title: "Smart Pruning UI Integration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-10T21:05:30.855Z"
completedAt: "2026-02-10T21:05:30.855Z"
acceptanceCriteria: []
description: "Expose Rex's smart pruning and restructuring capabilities in the web UI with visual diff and confirmation flow"
---

## Subtask: Add pruning interface to Rex dashboard

**ID:** `377d0c69-c006-4324-b462-bed82d698739`
**Status:** completed
**Priority:** high

Create a dedicated pruning section in the Rex dashboard that shows archivable items and allows users to configure pruning criteria

**Acceptance Criteria**

- Displays list of completed items eligible for archiving
- Shows estimated storage savings from pruning
- Provides pruning criteria configuration (age thresholds, completion status)
- Includes dry-run mode to preview changes

---

## Subtask: Implement visual diff for pruning operations

**ID:** `277e3243-02f3-4f64-a903-4d9a0abc84e7`
**Status:** completed
**Priority:** high

Show before/after tree structure with highlighted changes when users initiate pruning operations

**Acceptance Criteria**

- Displays tree diff showing items to be archived
- Highlights structural changes from reshaping consolidation
- Shows impact on completion percentages and epic structure
- Provides expandable detail view for each change

---

## Subtask: Add confirmation flow for destructive pruning operations

**ID:** `79cf9a3f-8e1e-4454-910b-ce3043feebf2`
**Status:** completed
**Priority:** high

Implement multi-step confirmation process for pruning operations with clear impact messaging

**Acceptance Criteria**

- Requires explicit confirmation before executing prune
- Shows clear warning for irreversible operations
- Displays summary of items to be affected
- Provides option to backup PRD before pruning

---

## Subtask: Enhance CLI pruning with interactive mode

**ID:** `61c178cc-d07e-4f59-8f2b-7ae496a4e5e6`
**Status:** completed
**Priority:** medium

Add interactive confirmation and preview capabilities to the CLI prune command

**Acceptance Criteria**

- Shows interactive preview of pruning changes in CLI
- Prompts for confirmation with item counts and impact
- Supports --dry-run flag for safe preview
- Displays progress during restructuring operations

---
