---
id: "0debe9bd-2497-46af-9bea-dea5413b8568"
level: "task"
title: "Move each rex MCP tool handler into its own module behind a registry"
status: "completed"
priority: "medium"
tags:
  - "pr-02"
  - "lane-rex-surface"
  - "rex"
source: "roadmap"
startedAt: "2026-10-06T04:46:29.609Z"
completedAt: "2026-10-06T05:45:50.002Z"
endedAt: "2026-10-06T05:45:50.002Z"
resolutionType: "code-change"
resolutionDetail: "Replaced cli/mcp-tools.ts (1,083 lines, 19 tools) with one module per tool under cli/mcp-tools/ plus registry.ts; mcp.ts now registers whatever the registry lists and dropped 376 to 152 lines. tools/list is byte-for-byte identical, pinned by a snapshot generated from the pre-split server."
acceptanceCriteria:
  - "mcp-tools.ts is replaced by per-tool modules and a registry"
  - "tests/e2e/mcp-transport.test.js and the rex MCP unit tests pass unchanged"
  - "The tools/list response is identical before and after (snapshot test)"
description: "Create rex/src/cli/mcp-tools/<tool>.ts per tool plus a registry module that mcp.ts reads. Keep tool names, input schemas, descriptions and responses byte-for-byte identical. No changeset beyond a patch note."
lastModified: "2026-10-06T05:45:53.264Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
