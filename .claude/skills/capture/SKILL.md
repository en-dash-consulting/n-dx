---
name: capture
description: Capture a requirement, feature idea, or task from conversation context
argument-hint: "[description]"
---

Capture a requirement, feature idea, or task from conversation context.

1. If a description is provided, use it. Otherwise, review recent conversation for feature requests, requirements, or product decisions
2. Call `get_prd_status` (rex MCP) to understand current PRD structure
3. Determine the appropriate level:
   - Epic: large initiative spanning multiple features
   - Feature: a capability or user-facing behavior
   - Task: a concrete, implementable work item
4. Find the appropriate parent by matching to existing epics/features
5. Draft the item: title, description, acceptance criteria
6. Present to the user for confirmation before creating
7. Use `add_item` (rex MCP) to create, then confirm placement in hierarchy
