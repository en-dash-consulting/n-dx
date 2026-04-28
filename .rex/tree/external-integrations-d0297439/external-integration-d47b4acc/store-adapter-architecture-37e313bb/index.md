---
id: "37e313bb-c278-4ff2-abb6-bc59fbe10761"
level: "task"
title: "Store Adapter Architecture"
status: "completed"
source: "llm"
startedAt: "2026-02-05T01:53:39.146Z"
completedAt: "2026-02-05T01:53:39.146Z"
description: "Clean interface for external data store integration"
---

## Subtask: Define clean adapter interface

**ID:** `9a6cc288-dd6f-4442-a12c-c0f9ad321a35`
**Status:** completed
**Priority:** high

Create interface that both file and external stores implement

**Acceptance Criteria**

- Common interface for all store types
- Supports CRUD operations on items
- Handles log append and config operations

---

## Subtask: Implement adapter registration system

**ID:** `c139d7f1-75b1-48bb-a4e7-88a5abd74f80`
**Status:** completed
**Priority:** medium

Support n-dx rex adapter add notion --token=<secret> style registration

**Acceptance Criteria**

- Command-line adapter registration
- Secure token storage
- Multiple adapter support

---

## Subtask: Add bidirectional sync support

**ID:** `7aa15b45-6ab2-4a49-b56e-590088400ced`
**Status:** completed
**Priority:** high

Bidirectional sync engine that coordinates between local and remote PRDStore instances. Supports push (local→remote), pull (remote→local), and full bidirectional sync with last-write-wins conflict resolution. Implementation spans core/sync.ts (primitives), core/sync-engine.ts (orchestration), and cli/commands/sync.ts (CLI). Sync metadata (lastModified, lastSyncedAt, remoteId) tracked on each PRDItem.

**Acceptance Criteria**

- External changes sync to local PRD
- Conflict detection and resolution
- Maintains data consistency

---
