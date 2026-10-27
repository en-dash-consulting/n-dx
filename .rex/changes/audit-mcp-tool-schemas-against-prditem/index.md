---
id: "8fc4844a-d6f9-480e-94c6-c8536f89c207"
type: "change"
title: "Audit MCP tool schemas against PRDItem fields"
slug: "audit-mcp-tool-schemas-against-prditem"
intent: "The edit_item MCP tool was missing the `level` field — it only exposed title, description, priority, tags, acceptanceCriteria, source, and blockedBy. Level was added ad-hoc during a restructuring session. There may be other mutable PRDItem fields not exposed through MCP tools. The MCP tool schemas should be systematically audited against the PRDItem type to ensure full coverage."
acceptanceCriteria:
  - "Every mutable field on PRDItem has a corresponding parameter in the appropriate MCP tool"
  - "A test asserts that the MCP tool schema keys are a superset of PRDItem mutable fields"
  - "Documentation lists which MCP tool handles which fields"
touches:
  - "5dd63e4e-1bbb-47a8-a0fa-754bc142a377"
priority: "medium"
tags:
  - "rex"
  - "mcp"
---
