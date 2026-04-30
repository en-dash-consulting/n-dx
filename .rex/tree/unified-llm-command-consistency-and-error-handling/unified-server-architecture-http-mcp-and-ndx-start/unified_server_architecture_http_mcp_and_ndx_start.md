---
id: "e96db771-5ed0-4ba8-a70b-74a30f462f65"
level: "feature"
title: "Unified Server Architecture: HTTP MCP and ndx start"
status: "completed"
priority: "high"
tags:
  - "dx"
  - "mcp"
  - "server"
startedAt: "2026-02-10T05:31:42.596Z"
completedAt: "2026-02-10T05:31:42.596Z"
acceptanceCriteria: []
description: "Replace the current stdio-only MCP setup with HTTP-served MCP endpoints, and introduce a single `ndx start` command that spins up both the web dashboard and MCP servers. Currently MCP requires manual `claude mcp add` per-server (stdio transport), and the web dashboard runs independently via `ndx web`. Goal: one command, one port, everything running — browser dashboard + MCP endpoints for any MCP client."
---

## Children

| Title | Status |
|-------|--------|
| [MCP over HTTP transport](./mcp-over-http-transport/index.md) | completed |
| [`ndx start` orchestration command](./ndx-start-orchestration-command/index.md) | completed |
| [rex_edit_item MCP tool](./rex-edit-item-mcp-tool/index.md) | completed |
| [Rex PRD management UI](./rex-prd-management-ui/index.md) | completed |
| [Unified web viewer architecture](./unified-web-viewer-architecture/index.md) | completed |
| [Web server and API integration](./web-server-and-api-integration/index.md) | completed |
