---
id: "8d4e7984-e4d4-4cbf-b458-23f6e24fa676"
type: "change"
title: "Add file-level locking to PRD store to prevent concurrent write corruption"
slug: "add-file-level-locking-to-prd-store-to"
intent: "When multiple writers (MCP server, CLI commands, reorganize, etc.) modify `.rex/prd.json` concurrently, the last writer wins and silently drops changes from other writers. This caused data loss when an MCP `add_item` call ran while `rex reorganize` was saving in the background.\n\nThe store layer (`packages/rex/src/store/`) should acquire an advisory file lock (e.g., `flock` or a `.rex/prd.lock` file) before reading and hold it through the write. Concurrent callers should either queue or fail fast with a clear error (\"PRD is locked by another operation\")."
acceptanceCriteria:
  - "Concurrent writes to prd.json are serialized or rejected with a clear error"
  - "MCP add/update/remove operations acquire the lock before modifying the PRD"
  - "CLI commands that write to prd.json (reorganize, prune, reshape, analyze) acquire the lock"
  - "Lock is released on process exit or crash (no stale locks)"
  - "Existing read-only operations (status, next) are not blocked"
amends: [{"target":"d6d0cbed-f63a-4434-a004-166c39cc8d2c","delta":"modified","summary":"Add file-level locking to PRD store to prevent concurrent write corruption","base":"6109d6be014383ee3bf4eee66fc279e494a6cccce459c9ad1387be54c8bd4f9b"}]
priority: "high"
tags:
  - "rex"
  - "reliability"
  - "concurrency"
---
