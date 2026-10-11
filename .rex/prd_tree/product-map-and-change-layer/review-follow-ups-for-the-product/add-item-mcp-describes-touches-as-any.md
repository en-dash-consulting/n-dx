---
id: "fd4fc3d4-5826-45e8-9417-92b403be582d"
level: "task"
title: "add_item MCP describes touches as any product node IDs, though an area is now refused"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The add_item MCP schema's touches description names capabilities and constraints, not product nodes (test asserts the description text)"
  - "prompt-census baseline agrees with the new description"
description: "Verdict: should-fix (low). After 383ce533 tightened ref-resolves, touches must name a capability or constraint. packages/rex/src/cli/mcp-tools/add-item.ts:214 still describes `touches` as \"product node IDs the change works on without amending them\". An agent following the description passes an area id. addChangeNode then refuses the change with a ref-resolves error (\"names an area ..., not a capability or a constraint\"). That is recoverable, but it costs a turn. Fix: reword to \"capability or constraint IDs\". Check whether prompt-census counts MCP descriptions and refresh the baseline if so."
lastModified: "2026-10-10T17:54:39.784Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
