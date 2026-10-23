---
id: "a90cf2ff-f346-43bb-9df0-c6ec954a712a"
type: "change"
title: "Update rex write commands (add, edit, remove, move) to persist changes to folder tree after every mutation"
slug: "update-rex-write-commands-add-edit"
intent: "Modify rex add, edit, remove, and move so that after every write to PRDStore, the affected subtree is re-serialized to the folder structure on disk. add creates a new folder and updates all ancestor index.md summaries; edit rewrites the item's index.md and propagates summary changes upward; remove deletes the folder and cleans parent summaries; move relocates the folder and updates both old and new parent summaries."
acceptanceCriteria:
  - "rex add creates the correct folder hierarchy and updates all ancestor index.md summary sections"
  - "rex edit rewrites target index.md with new field values and updates parent summaries where title or status changed"
  - "rex remove deletes the item folder and removes it from all parent summary sections"
  - "rex move relocates the folder to the new parent directory and updates both origin and destination parent summaries"
  - "No command leaves orphaned folders or stale parent summary entries after completion"
  - "All four commands complete without observable latency regression vs single-file baseline"
touches:
  - "ce2ecf83-8a69-4ccc-ad43-6243d4c3646b"
priority: "critical"
tags:
  - "prd"
  - "cli"
  - "write"
source: "smart-add"
---
