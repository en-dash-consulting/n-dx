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

# Unified Server Architecture: HTTP MCP and ndx start

🟠 [completed]

## Summary

Replace the current stdio-only MCP setup with HTTP-served MCP endpoints, and introduce a single `ndx start` command that spins up both the web dashboard and MCP servers. Currently MCP requires manual `claude mcp add` per-server (stdio transport), and the web dashboard runs independently via `ndx web`. Goal: one command, one port, everything running — browser dashboard + MCP endpoints for any MCP client.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| MCP over HTTP transport | task | completed | 2026-02-10 |
| `ndx start` orchestration command | task | completed | 2026-02-10 |
| rex_edit_item MCP tool | task | completed | 2026-03-09 |
| Rex PRD management UI | task | completed | 2026-02-06 |
| Unified web viewer architecture | task | completed | 2026-02-06 |
| Web server and API integration | task | completed | 2026-02-06 |

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** dx, mcp, server
- **Level:** feature
- **Started:** 2026-02-10T05:31:42.596Z
- **Completed:** 2026-02-10T05:31:42.596Z
- **Duration:** < 1m
