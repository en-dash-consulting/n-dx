---
id: "9fa85475-a6ff-474a-bf4f-e1f531df7916"
type: "change"
title: "Move file lock to saveDocument for complete write safety"
slug: "move-file-lock-to-savedocument-for"
intent: "File locking was added to the convenience methods (addItem, updateItem, removeItem) but CLI commands like reorganize, prune, and reshape do their own loadDocument → mutate → saveDocument outside those methods, bypassing the lock entirely. The lock should be at the saveDocument level (or a withTransaction API) so all write paths are protected, not just the store convenience methods."
acceptanceCriteria:
  - "All writes to prd.json go through a single lock regardless of whether they use convenience methods or direct saveDocument"
  - "CLI commands (reorganize, prune, reshape) are protected from concurrent MCP writes"
  - "Lock is acquired before loadDocument and held through saveDocument to prevent read-modify-write races"
  - "Existing convenience methods still work without callers needing to acquire locks manually"
touches:
  - "5ec16345-5c46-4197-9fa3-bcb50d58ce19"
priority: "high"
tags:
  - "rex"
  - "reliability"
  - "concurrency"
---
