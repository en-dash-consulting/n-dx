---
id: "f16ab364-971a-43ab-94e7-173a891264d1"
type: "change"
title: "Update ndx plan, ndx recommend, and all MCP write tools to propagate writes to the folder tree"
slug: "update-ndx-plan-ndx-recommend-and-all"
intent: "Ensure that ndx plan --accept, ndx recommend --accept, and all MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items) route their writes through the folder-tree serializer after every mutation. MCP tools must complete within existing latency budgets."
acceptanceCriteria:
  - "ndx plan --accept creates the correct folder structure for all accepted proposals"
  - "ndx recommend --accept creates folders for all accepted recommendations and updates parent summaries"
  - "Each MCP write tool call leaves the folder tree consistent: correct folders, updated index.md, updated parent summaries"
  - "MCP write tools complete within existing tool-call latency budgets (no regression measured in mcp-transport.test.js)"
  - "Integration test confirms folder tree item count matches PRD item count after a full ndx plan --accept run"
touches:
  - "ce2ecf83-8a69-4ccc-ad43-6243d4c3646b"
priority: "high"
tags:
  - "prd"
  - "mcp"
  - "orchestration"
source: "smart-add"
---
