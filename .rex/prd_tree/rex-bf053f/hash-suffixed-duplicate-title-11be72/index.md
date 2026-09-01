---
id: "11be7299-0ef9-4b4e-808a-a09e98fe708e"
level: "feature"
title: "Hash-Suffixed Duplicate Title Consolidation in Reshape"
status: "completed"
source: "smart-add"
startedAt: "2026-05-14T14:14:16.575Z"
completedAt: "2026-05-14T14:14:16.575Z"
endedAt: "2026-05-14T14:14:16.575Z"
acceptanceCriteria: []
description: "Extend the reshape command to detect tasks whose titles differ only by a trailing hash/ID suffix (e.g. 'Fix observation in global (abc123)') and consolidate them into a single canonical item. The consolidation must reassign children of older duplicates to the surviving item, merge body content into a generalized description that fits the combined case, or — when the items represent meaningfully distinct work — create a parent container and rename each child to reflect its specific scope. This logic must run in two places: during `ndx reshape` and automatically after every `ndx add` / `rex add` write path so that the PRD never accumulates near-duplicate siblings."
---

## Children

| Title | Status |
|-------|--------|
| [Auto-trigger reshape consolidation pass after ndx add and rex add](./auto-trigger-reshape-9708b8.md) | completed |
| [Consolidate hash-suffixed duplicates with child reassignment and body merge](./consolidate-hash-suffixed-c60d54.md) | completed |
| [Implement hash-suffix-aware duplicate title detector for reshape consolidation](./implement-hash-suffix-aware-760d43.md) | completed |
