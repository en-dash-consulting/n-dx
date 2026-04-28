---
id: "0f1065fb-1549-49f6-aa03-991d7e6eadee"
level: "task"
title: "Interactive parent-child inconsistency resolution"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T21:13:45.905Z"
completedAt: "2026-02-24T21:13:45.905Z"
description: "Enhance existing rex validate and fix commands to detect parent-child structural inconsistencies and provide interactive resolution workflows for user-guided corrections"
---

## Subtask: Add interactive prompts to rex validate for parent-child inconsistencies

**ID:** `614db87b-e102-4049-8ff0-47e9b5cf566e`
**Status:** completed
**Priority:** high

Update rex validate command to detect epicless features and present interactive resolution options, allowing users to choose between correlation recovery and safe deletion workflows

**Acceptance Criteria**

- Detects features positioned at root level without parent epics during validation
- Presents interactive prompt with correlation and deletion options
- Maintains backward compatibility with existing non-interactive validation behavior
- Handles user cancellation and invalid input gracefully

---

## Subtask: Implement epic correlation recovery for orphaned features

**ID:** `f4709451-4cce-48d4-9512-f054064dfc4e`
**Status:** completed
**Priority:** high

Build recovery workflow that analyzes epicless features and suggests appropriate parent epics based on content analysis and existing PRD structure, enabling automated reparenting with user approval

**Acceptance Criteria**

- Analyzes feature content and suggests semantically similar parent epics
- Ranks suggestions based on content similarity and structural fit
- Successfully reparents features while preserving all metadata and relationships
- Provides fallback options when no suitable parent epic is found

---

## Subtask: Add integrity-protected deletion option for epicless features

**ID:** `b5dfa9b2-ad8a-4dcd-b871-7c6308a378e5`
**Status:** completed
**Priority:** medium

Implement safe deletion workflow for epicless features with comprehensive dependency checks and corruption prevention safeguards, ensuring PRD structural integrity is maintained

**Acceptance Criteria**

- Validates no dependent tasks or external references before deletion
- Checks adapter sync states and prevents deletion if external corruption risk exists
- Requires explicit user confirmation with clear consequence warnings
- Maintains all PRD relationships and referential integrity after deletion

---
