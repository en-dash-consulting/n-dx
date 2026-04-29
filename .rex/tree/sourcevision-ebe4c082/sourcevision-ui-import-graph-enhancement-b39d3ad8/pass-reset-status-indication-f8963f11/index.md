---
id: "f8963f11-6f0f-464a-a5e4-a7df16cfc992"
level: "task"
title: "Pass Reset Status Indication"
status: "completed"
source: "smart-add"
startedAt: "2026-02-10T20:32:59.824Z"
completedAt: "2026-02-10T20:32:59.824Z"
acceptanceCriteria: []
description: "Improve user feedback when SourceVision detects changes and resets to lower analysis passes\n\n---\n\nCreate a centralized configuration panel for managing experimental or problematic features across the n-dx toolkit"
---

## Subtask: Add pass reset notification during analysis

**ID:** `e1aba2dc-31e7-470b-954b-8f107012dc92`
**Status:** completed
**Priority:** medium

Display a clear message when SourceVision detects changes and resets from a higher pass (e.g., Pass 5) to a lower pass (e.g., Pass 2) during the same analyze command execution

**Acceptance Criteria**

- Shows 'Detected changes, resetting from Pass X to Pass Y' message when reset occurs
- Message appears before continuing with the lower pass analysis
- Reset notification is visible in both CLI and web UI contexts

---

## Subtask: Fix pass status display inconsistency after reset

**ID:** `cf8aecd3-da57-4085-8d40-c4b0d55dbfb9`
**Status:** completed
**Priority:** high

Ensure the pass status output reflects the actual current pass immediately after a reset, rather than showing the previous higher pass number

**Acceptance Criteria**

- Pass status output shows correct current pass number after reset
- No need to run sv analyze twice to see accurate pass status
- Status remains consistent between analyze runs and status queries

---

## Subtask: Create feature toggle configuration section in n-dx config

**ID:** `b3a50216-5a96-47ff-99b1-b6b5bb60a56e`
**Status:** completed
**Priority:** low

Build a dedicated configuration area within the unified config system that allows users to enable/disable experimental or problematic features across all n-dx packages

---
