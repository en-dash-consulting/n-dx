---
id: "650a6619-ba5f-4e24-bb4d-6d389521c2ef"
level: "task"
title: "Store Contract Compliance"
status: "completed"
source: "llm"
startedAt: "2026-02-08T15:28:49.613Z"
completedAt: "2026-02-08T15:28:49.613Z"
description: "Ensure all store implementations meet the required contract"
---

## Subtask: Enhance document operations

**ID:** `c2a3ad4a-1a4a-4467-a979-e067f3dc1c6b`
**Status:** completed
**Priority:** high

Ensured robust document loading and saving across store implementations. Added saveDocument validation to FileStore and NotionStore to prevent persisting invalid documents. Added 11 new tests covering: document loading, schema version checks, round-trip with deep hierarchies, round-trip with all optional fields, passthrough field preservation, invalid document rejection, and corrupt JSON handling.

**Acceptance Criteria**

- loads a valid document
- loads a valid document with schema version
- round-trips a document
- round-trips a document with items
- saveDocument replaces the full document state

---

## Subtask: Verify store contract compliance

**ID:** `7caae0b8-bb71-4374-a40d-8614a1b5080a`
**Status:** completed
**Priority:** high

Ensure all store implementations meet the required contract for item management, configuration loading, and logging.

**Acceptance Criteria**

- adds item to root
- adds item under parent
- adds item to root when no parentId
- adds item under parent when parentId provided
- updates item fields
- archives removed items
- loads a valid config with project name
- appends and reads entries in chronological order

---
