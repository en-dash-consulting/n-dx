---
id: "653cb773-dd9d-467c-880a-bc8c8de9cbe2"
level: "task"
title: "rex_edit_item MCP tool"
status: "completed"
source: "smart-add"
startedAt: "2026-03-09T01:23:07.809Z"
completedAt: "2026-03-09T01:23:07.809Z"
acceptanceCriteria: []
description: "Expose a dedicated edit_item action on the rex MCP server so AI agents and Claude Code can modify PRD item content (title, description, acceptance criteria, priority, tags, LoE fields) in a single structured call — distinct from rex_update which handles status/lifecycle transitions."
---

## Subtask: Implement rex_edit_item tool handler and schema

**ID:** `322588c0-9776-4853-a0e4-13cffc4dd37e`
**Status:** completed
**Priority:** high

Add an edit_item tool to the rex MCP server that accepts a target item ID and a partial patch of editable fields (title, description, acceptanceCriteria, priority, tags, loe, loeRationale, loeConfidence). The handler should validate the patch against the PRD schema, apply it via the existing PRDStore mutation API, and return the updated item. Wire the new tool into the MCP tool registry alongside the existing rex tools.

**Acceptance Criteria**

- edit_item tool is listed in the rex MCP tool manifest returned by list-tools
- Calling edit_item with a valid item ID and partial patch updates exactly the specified fields and leaves all other fields unchanged
- Calling edit_item with an unknown item ID returns a structured MCP error response (not a server crash)
- Calling edit_item with an invalid field value (e.g. unrecognized priority string) returns a descriptive validation error
- The updated item is persisted to prd.json and visible in a subsequent rex_status call
- Unit tests cover field merging, unknown ID, and invalid value cases

---

## Subtask: Expose edit_item through rex-gateway and add MCP integration test

**ID:** `45937170-e43c-47ca-93d5-a86fa3bdc1a0`
**Status:** completed
**Priority:** high

Re-export the new edit_item capability through the web rex-gateway.ts so the HTTP MCP server can reach it without bypassing the gateway pattern. Add an integration test that calls the edit_item endpoint over HTTP transport, verifies the 200 response shape, and confirms the change is reflected in a follow-up rex_status call.

**Acceptance Criteria**

- rex-gateway.ts re-exports the edit_item function; no direct imports of rex internals exist outside the gateway
- domain-isolation.test.js passes without modification (gateway re-export-only rule still holds)
- Integration test POSTs an edit_item call to the HTTP MCP endpoint and asserts the response contains the updated item fields
- Integration test asserts a follow-up rex_status call reflects the edited values
- CI pipeline passes with the new test included

---
