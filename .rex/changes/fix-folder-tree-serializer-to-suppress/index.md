---
id: "df5fc980-59b8-4e1d-8e24-49e82ca20f5c"
type: "change"
title: "Fix folder-tree serializer to suppress index.md when fewer than two named child files exist"
slug: "fix-folder-tree-serializer-to-suppress"
intent: "The serializer currently writes an index.md for every directory it creates, even when the folder holds only one named file. The rule must be: emit an index.md only when the folder contains two or more distinct named child files (excluding index.md itself). When exactly one named file exists, write only that named file — no index.md. This prevents the duplicate front-matter situation where the same item's metadata appears in both files."
acceptanceCriteria:
  - "Serializer writes no index.md when a folder contains exactly one named child file"
  - "Serializer writes index.md only when two or more unique named child files exist in the same folder"
  - "Round-trip parse of a single-child folder returns identical PRD item data as before"
  - "No front-matter field (id, title, status, priority, etc.) is duplicated between the named file and any co-located index.md"
touches:
  - "9656fa3b-3e46-4951-b706-75f93fc1ddbb"
priority: "critical"
tags:
  - "prd-storage"
  - "serializer"
  - "bug"
source: "smart-add"
---
