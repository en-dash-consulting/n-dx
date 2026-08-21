---
id: "92864e0c-5476-4771-b05a-e75b9859fd2e"
level: "feature"
title: "PRD write attribution and change stamps"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "Discovery Option 3 (+ the sync-engine fix). Every local PRD mutation stamps lastModified and actor. This is the single highest-leverage change: it fixes SyncEngine change detection (locally edited items are currently skipped on push because FolderTreeStore never stamps lastModified), enables attribution, enables claim expiry, and gives the future merge driver a resolution timestamp."
---

## Children

| Title | Status |
|-------|--------|
| [Actor attribution on hench RunRecord](./actor-attribution-on-hench-runrecord.md) | pending |
| [Actor resolution and lastModifiedBy in rex](./actor-resolution-and-3bb125.md) | completed |
| [Stamp lastModified on FolderTreeStore writes](./stamp-lastmodified-on-3cd289.md) | completed |
