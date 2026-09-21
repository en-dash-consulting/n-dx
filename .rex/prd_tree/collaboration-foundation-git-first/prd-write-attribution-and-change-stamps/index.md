---
id: "92864e0c-5476-4771-b05a-e75b9859fd2e"
level: "feature"
title: "PRD write attribution and change stamps"
status: "completed"
priority: "critical"
startedAt: "2026-08-21T04:28:55.742Z"
completedAt: "2026-08-21T04:28:55.742Z"
endedAt: "2026-08-21T04:28:55.742Z"
acceptanceCriteria: []
description: "Discovery Option 3 (+ the sync-engine fix). Every local PRD mutation stamps lastModified and actor. This is the single highest-leverage change: it fixes SyncEngine change detection (locally edited items are currently skipped on push because FolderTreeStore never stamps lastModified), enables attribution, enables claim expiry, and gives the future merge driver a resolution timestamp."
lastModified: "2026-08-21T04:28:55.748Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Actor attribution on hench RunRecord](./actor-attribution-on-hench-runrecord.md) | completed |
| [Actor resolution and lastModifiedBy in rex](./actor-resolution-and-lastmodifiedby-in.md) | completed |
| [Stamp lastModified on FolderTreeStore writes](./stamp-lastmodified-on-foldertreestore.md) | completed |
