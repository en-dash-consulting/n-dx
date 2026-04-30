---
id: "1797eb3e-8ef9-4148-80fe-966693dd4e97"
level: "feature"
title: "Title-Based PRD Item File Naming Convention"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T01:26:33.258Z"
completedAt: "2026-04-30T01:26:33.258Z"
endedAt: "2026-04-30T01:26:33.258Z"
acceptanceCriteria: []
description: "Replace the current per-item `index.md` convention with markdown files named after the item title (lowercase, underscores instead of spaces, punctuation stripped). Each PRD item folder will contain one title-named markdown file holding the item's primary content; `index.md` is repurposed by a separate feature into a folder-level summary."
---

# Title-Based PRD Item File Naming Convention

 [completed]

## Summary

Replace the current per-item `index.md` convention with markdown files named after the item title (lowercase, underscores instead of spaces, punctuation stripped). Each PRD item folder will contain one title-named markdown file holding the item's primary content; `index.md` is repurposed by a separate feature into a folder-level summary.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Define title-to-filename normalization rules and implement pure helper | task | completed | 2026-04-30 |
| Implement migration command to rename legacy index.md files to title-based names | task | completed | 2026-04-30 |
| Update PRD folder-tree serializer and parser to read/write title-named markdown files | task | completed | 2026-04-30 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-30T01:26:33.258Z
- **Completed:** 2026-04-30T01:26:33.258Z
- **Duration:** < 1m
