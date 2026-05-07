---
id: "df5fc980-59b8-4e1d-8e24-49e82ca20f5c"
level: "task"
title: "Fix folder-tree serializer to suppress index.md when fewer than two named child files exist"
status: "completed"
priority: "critical"
tags:
  - "prd-storage"
  - "serializer"
  - "bug"
source: "smart-add"
startedAt: "2026-05-07T00:00:48.391Z"
completedAt: "2026-05-07T00:12:00.011Z"
endedAt: "2026-05-07T00:12:00.011Z"
resolutionType: "code-change"
resolutionDetail: "Implemented index.md suppression in serializer for leaf items. Only non-leaf items (those with children) write index.md, eliminating duplicate frontmatter. All 44 folder-tree-serializer tests pass."
acceptanceCriteria:
  - "Serializer writes no index.md when a folder contains exactly one named child file"
  - "Serializer writes index.md only when two or more unique named child files exist in the same folder"
  - "Round-trip parse of a single-child folder returns identical PRD item data as before"
  - "No front-matter field (id, title, status, priority, etc.) is duplicated between the named file and any co-located index.md"
description: "The serializer currently writes an index.md for every directory it creates, even when the folder holds only one named file. The rule must be: emit an index.md only when the folder contains two or more distinct named child files (excluding index.md itself). When exactly one named file exists, write only that named file — no index.md. This prevents the duplicate front-matter situation where the same item's metadata appears in both files."
---
