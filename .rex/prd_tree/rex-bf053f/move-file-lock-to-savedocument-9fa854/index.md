---
id: "9fa85475-a6ff-474a-bf4f-e1f531df7916"
level: "feature"
title: "Move file lock to saveDocument for complete write safety"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "reliability"
  - "concurrency"
startedAt: "2026-03-24T05:12:16.787Z"
endedAt: "2026-08-25T19:05:43.076Z"
acceptanceCriteria:
  - "All writes to prd.json go through a single lock regardless of whether they use convenience methods or direct saveDocument"
  - "CLI commands (reorganize, prune, reshape) are protected from concurrent MCP writes"
  - "Lock is acquired before loadDocument and held through saveDocument to prevent read-modify-write races"
  - "Existing convenience methods still work without callers needing to acquire locks manually"
description: "File locking was added to the convenience methods (addItem, updateItem, removeItem) but CLI commands like reorganize, prune, and reshape do their own loadDocument → mutate → saveDocument outside those methods, bypassing the lock entirely. The lock should be at the saveDocument level (or a withTransaction API) so all write paths are protected, not just the store convenience methods."
lastModified: "2026-08-27T19:04:55.232Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Every PRD write path does an unlocked load→mutate→save, so a concurrent writer's item is silently dropped](./every-prd-write-path-does-an-88f1ce.md) | completed |
| [The lost-update guard test intermittently fails under load — either a locking hole or a bad test bound](./the-lost-update-guard-test-ff501e.md) | pending |
