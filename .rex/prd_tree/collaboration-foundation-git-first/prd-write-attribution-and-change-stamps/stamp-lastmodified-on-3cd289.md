---
id: "3cd28918-7b03-4f8b-a9d4-6de481cb4934"
level: "task"
title: "Stamp lastModified on FolderTreeStore writes"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "FolderTreeStore.addItem/updateItem accept WriteOptions but ignore them (applyAttribution is a no-op) and never stamp lastModified, which breaks SyncEngine change detection: isModifiedSinceSync() returns false when the stamp is absent, so locally edited items are skipped on push. Stamp an ISO lastModified on every mutation in packages/rex/src/store/folder-tree-store.ts; the serializer/parser already round-trip unknown frontmatter keys. PR boundary: this change only — no actor fields, no slug changes. Acceptance criteria: (1) every addItem/updateItem/removeItem path stamps lastModified; (2) a sync-engine unit test proves a locally edited item is detected as modified and pushes; (3) serializer round-trip test preserves the stamp; (4) no schema-breaking changes."
---
