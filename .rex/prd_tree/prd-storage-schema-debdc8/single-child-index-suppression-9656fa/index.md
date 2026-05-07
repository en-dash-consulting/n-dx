---
id: "9656fa3b-3e46-4951-b706-75f93fc1ddbb"
level: "feature"
title: "Single-Child Index Suppression and Front-Matter Deduplication Fix"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "The single-child compaction landed in the prior cycle but did not prevent index.md files from being created alongside a single named file. This feature enforces the invariant at the serializer level: an index.md must only be written when a folder contains two or more unique named child files. It also eliminates the duplicate front-matter that currently appears between a named file and its co-located index.md."
---

# Single-Child Index Suppression and Front-Matter Deduplication Fix

 [pending]

## Summary

The single-child compaction landed in the prior cycle but did not prevent index.md files from being created alongside a single named file. This feature enforces the invariant at the serializer level: an index.md must only be written when a folder contains two or more unique named child files. It also eliminates the duplicate front-matter that currently appears between a named file and its co-located index.md.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix folder-tree serializer to suppress index.md when fewer than two named child files exist | task | in_progress | 2026-05-07 |

## Info

- **Status:** pending
- **Level:** feature
