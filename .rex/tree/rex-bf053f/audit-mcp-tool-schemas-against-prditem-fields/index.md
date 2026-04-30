---
id: "8fc4844a-d6f9-480e-94c6-c8536f89c207"
level: "feature"
title: "Audit MCP tool schemas against PRDItem fields"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "mcp"
startedAt: "2026-03-24T05:21:24.525Z"
completedAt: "2026-03-24T05:23:53.235Z"
acceptanceCriteria:
  - "Every mutable field on PRDItem has a corresponding parameter in the appropriate MCP tool"
  - "A test asserts that the MCP tool schema keys are a superset of PRDItem mutable fields"
  - "Documentation lists which MCP tool handles which fields"
description: "The edit_item MCP tool was missing the `level` field — it only exposed title, description, priority, tags, acceptanceCriteria, source, and blockedBy. Level was added ad-hoc during a restructuring session. There may be other mutable PRDItem fields not exposed through MCP tools. The MCP tool schemas should be systematically audited against the PRDItem type to ensure full coverage."
---

# Audit MCP tool schemas against PRDItem fields

🟡 [completed]

## Summary

The edit_item MCP tool was missing the `level` field — it only exposed title, description, priority, tags, acceptanceCriteria, source, and blockedBy. Level was added ad-hoc during a restructuring session. There may be other mutable PRDItem fields not exposed through MCP tools. The MCP tool schemas should be systematically audited against the PRDItem type to ensure full coverage.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** rex, mcp
- **Level:** feature
- **Started:** 2026-03-24T05:21:24.525Z
- **Completed:** 2026-03-24T05:23:53.235Z
- **Duration:** 2m
