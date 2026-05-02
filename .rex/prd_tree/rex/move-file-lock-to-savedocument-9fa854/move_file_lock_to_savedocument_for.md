---
id: "9fa85475-a6ff-474a-bf4f-e1f531df7916"
level: "feature"
title: "Move file lock to saveDocument for complete write safety"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "reliability"
  - "concurrency"
startedAt: "2026-03-24T05:12:16.787Z"
completedAt: "2026-03-24T05:20:58.936Z"
acceptanceCriteria:
  - "All writes to prd.json go through a single lock regardless of whether they use convenience methods or direct saveDocument"
  - "CLI commands (reorganize, prune, reshape) are protected from concurrent MCP writes"
  - "Lock is acquired before loadDocument and held through saveDocument to prevent read-modify-write races"
  - "Existing convenience methods still work without callers needing to acquire locks manually"
description: "File locking was added to the convenience methods (addItem, updateItem, removeItem) but CLI commands like reorganize, prune, and reshape do their own loadDocument → mutate → saveDocument outside those methods, bypassing the lock entirely. The lock should be at the saveDocument level (or a withTransaction API) so all write paths are protected, not just the store convenience methods."
---
