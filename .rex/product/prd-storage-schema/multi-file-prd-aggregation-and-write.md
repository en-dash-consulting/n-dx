---
id: "e006db37-8fc4-4380-bc61-78218dd03e18"
type: "capability"
title: "Multi-File PRD Aggregation and Write Routing Layer"
slug: "multi-file-prd-aggregation-and-write"
statement: "The PRD store aggregates items from every PRD file into a single unified view for reads and routes each write to the PRD file that owns the affected item."
criteria: [{"id":"c1","text":"When the PRD store loads, the PRD store shall merge the items from every prd_*.json file in .rex/ into a single in-memory item tree."},{"id":"c2","text":"If the same item ID appears in more than one PRD file, the PRD store shall detect the collision and report it."},{"id":"c3","text":"rex status shall show the items from all PRD files in a single unified tree."},{"id":"c4","text":"rex next shall consider tasks from all PRD files when it selects the next task by priority."},{"id":"c5","text":"The MCP read tools get_prd_status, get_item and get_next_task shall return data aggregated from all PRD files."},{"id":"c6","text":"The PRD store shall track, after aggregation, which PRD file owns each item in the in-memory store."},{"id":"c7","text":"When update_task_status changes an item, the PRD store shall write only to the PRD file that owns that item."},{"id":"c8","text":"When an item is edited, moved or removed, the PRD store shall write the change to the PRD file that owns that item."},{"id":"c9","text":"When an item is created during the current session, the PRD store shall write it to the current branch's PRD file."},{"id":"c10","text":"The PRD store shall lock each PRD file separately, so that reads of one PRD file are not blocked by a lock on a different PRD file."},{"id":"c11","text":"The MCP write tools add_item, edit_item, update_task_status, move_item and merge_items shall route each write to the correct PRD file."}]
source: "smart-add"
---

Refactor the PRDStore to aggregate items from all PRD files for read operations and route write operations to the correct branch-scoped file, preserving all existing command behavior while operating transparently on multiple underlying storage files.
