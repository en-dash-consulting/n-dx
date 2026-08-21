---
"@n-dx/rex": patch
---

Resolve actor identity (git `user.name`/`user.email` → `os.userInfo()` → `"unknown"`, cached per process) and stamp attribution on writes: `stampModified()` now also sets `lastModifiedBy` on PRD item mutations, and the new `stampActor()` sets `actor` on execution-log entries. Wired into every mutation-capable store: `FileStore` (the production writer), `FolderTreeStore`, and the Asana/Notion/Jira/GitHub Projects adapters. Both fields are passthrough on the existing schemas — additive, non-breaking.
