---
name: work
description: Pick up a task from the PRD and begin working on it
argument-hint: "[task-id]"
---

Pick up a task from the PRD and begin working on it.

1. If task-id provided, call `get_item` (rex MCP). Otherwise call `get_next_task` (rex MCP)
2. Read task details: title, description, acceptance criteria, parent chain
3. For files mentioned in the task, use `get_file_info` and `get_imports` (sourcevision MCP) to understand current state
4. Use `get_zone` (sourcevision MCP) for the relevant architectural zone
5. Present a work plan: what needs to change, which files, what tests
6. After user approves the plan, call `update_task_status` (rex MCP) to mark as `in_progress`
7. Implement the changes
8. When done, use `update_task_status` (rex MCP) to mark as `completed`
