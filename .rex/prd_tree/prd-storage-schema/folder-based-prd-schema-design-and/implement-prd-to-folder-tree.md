---
id: "3b80109b-5158-4236-8052-6571bb9f69e9"
level: "task"
title: "Implement PRD-to-folder-tree serializer that writes nested directories with index.md files"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "serializer"
source: "smart-add"
startedAt: "2026-04-27T19:02:03.328Z"
completedAt: "2026-04-27T19:20:57.471Z"
endedAt: "2026-04-27T19:20:57.471Z"
acceptanceCriteria:
  - "Running the serializer on a known PRD produces the expected folder tree with correct nesting depth"
  - "Each index.md contains the item's full metadata: title, status, description, acceptance criteria, tags, LoE"
  - "Every non-leaf index.md includes a children-summary section listing direct children with title and status"
  - "Task index.md encodes subtasks as level-3 sections within the same file"
  - "Slug collisions are resolved deterministically by appending a short ID suffix"
  - "Re-running serializer on an unchanged tree produces no file writes (idempotent)"
description: "Build the serializer that takes the in-memory PRD tree and writes it to disk as a nested folder hierarchy under .rex/prd/. Epic folders contain feature subfolders; feature folders contain task subfolders; task folders contain only index.md. Each parent index.md includes a human-readable summary of all items below it. Serialization must be incremental: only changed subtrees are rewritten."
---
