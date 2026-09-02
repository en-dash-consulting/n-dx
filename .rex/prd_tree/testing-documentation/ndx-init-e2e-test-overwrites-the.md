---
id: "daf5646c-0deb-43dc-9297-41c7ad894ada"
level: "task"
title: "ndx init e2e test overwrites the developer's real MCP registration"
status: "completed"
priority: "high"
source: "ndx-capture"
startedAt: "2026-09-01T13:39:40.880Z"
completedAt: "2026-09-01T13:49:11.359Z"
endedAt: "2026-09-01T13:49:11.359Z"
acceptanceCriteria:
  - "Running the ndx init e2e suite leaves the developer's global Claude MCP registration byte-identical"
  - "The e2e test registers MCP servers into an isolated config directory scoped to its temp project"
  - "A regression test fails if init writes an MCP server entry whose target path is outside the project being initialised"
  - "Documented recovery step for developers whose config was already clobbered by an earlier run"
description: "An `ndx init` e2e run registered rex and sourcevision against its own temp project directory in the developer's real Claude MCP config. Observed on this machine: `claude mcp list` shows both servers pointed at /var/folders/74/.../T/ndx-init-e2e-TX4mOe — a directory deleted when the test finished — and both report 'Failed to connect: CONNECTION_CLOSED'. The rex and sourcevision MCP tools were unusable for the whole session; every PRD write had to be driven through packages/rex/dist directly. The test needs to register into an isolated config (e.g. a temp CLAUDE_CONFIG_DIR / --scope local against the temp project) and restore or never touch the user's global registration, and it should assert it left the global config untouched."
lastModified: "2026-09-01T13:49:11.365Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
