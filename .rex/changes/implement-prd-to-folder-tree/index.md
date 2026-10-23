---
id: "3b80109b-5158-4236-8052-6571bb9f69e9"
type: "change"
title: "Implement PRD-to-folder-tree serializer that writes nested directories with index.md files"
slug: "implement-prd-to-folder-tree"
intent: "Build the serializer that takes the in-memory PRD tree and writes it to disk as a nested folder hierarchy under .rex/prd/. Epic folders contain feature subfolders; feature folders contain task subfolders; task folders contain only index.md. Each parent index.md includes a human-readable summary of all items below it. Serialization must be incremental: only changed subtrees are rewritten."
acceptanceCriteria:
  - "Running the serializer on a known PRD produces the expected folder tree with correct nesting depth"
  - "Each index.md contains the item's full metadata: title, status, description, acceptance criteria, tags, LoE"
  - "Every non-leaf index.md includes a children-summary section listing direct children with title and status"
  - "Task index.md encodes subtasks as level-3 sections within the same file"
  - "Slug collisions are resolved deterministically by appending a short ID suffix"
  - "Re-running serializer on an unchanged tree produces no file writes (idempotent)"
amends: [{"target":"7286f1c2-ad19-4f85-baa9-cebb3c77a49d","delta":"modified","summary":"Implement PRD-to-folder-tree serializer that writes nested directories with index.md files","base":"f655ec53f906fbb1d1497cb8d1c154cbbe36f07d40f2f25b8a648802f5c2c3a6"}]
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "serializer"
source: "smart-add"
---
