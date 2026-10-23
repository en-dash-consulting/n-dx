---
id: "88f3b468-8d85-421b-a881-d7d61c8f84ae"
type: "change"
title: "Refactor PRDStore write operations to route modifications to the owning PRD file"
slug: "refactor-prdstore-write-operations-to"
intent: "Modify the PRDStore's save, update, and remove paths to track which PRD file owns each item and write changes back to the correct file. New items added via the current branch go to that branch's PRD file. Status updates, edits, moves, and removes target the file that contains the item being modified. File locking operates per-file."
acceptanceCriteria:
  - "Item-to-file ownership is tracked in the in-memory store after aggregation"
  - "update_task_status writes only to the PRD file that owns the target item"
  - "edit_item, move_item, and remove operations target the correct owning file"
  - "New items created during the current session are written to the current branch's PRD file"
  - "File locking operates per-file so concurrent reads of different PRD files are not blocked"
  - "MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items) route to the correct file"
touches:
  - "e006db37-8fc4-4380-bc61-78218dd03e18"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "prd-store"
source: "smart-add"
---
