---
id: "a90cf2ff-f346-43bb-9df0-c6ec954a712a"
level: "task"
title: "Update rex write commands (add, edit, remove, move) to persist changes to folder tree after every mutation"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "cli"
  - "write"
source: "smart-add"
startedAt: "2026-04-27T19:21:11.109Z"
completedAt: "2026-04-27T23:29:18.791Z"
endedAt: "2026-04-27T23:29:18.791Z"
acceptanceCriteria:
  - "rex add creates the correct folder hierarchy and updates all ancestor index.md summary sections"
  - "rex edit rewrites target index.md with new field values and updates parent summaries where title or status changed"
  - "rex remove deletes the item folder and removes it from all parent summary sections"
  - "rex move relocates the folder to the new parent directory and updates both origin and destination parent summaries"
  - "No command leaves orphaned folders or stale parent summary entries after completion"
  - "All four commands complete without observable latency regression vs single-file baseline"
description: "Modify rex add, edit, remove, and move so that after every write to PRDStore, the affected subtree is re-serialized to the folder structure on disk. add creates a new folder and updates all ancestor index.md summaries; edit rewrites the item's index.md and propagates summary changes upward; remove deletes the folder and cleans parent summaries; move relocates the folder and updates both old and new parent summaries."
---
