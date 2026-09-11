---
id: "e4df3296-b5d3-4e5e-b9d5-564524aa8a53"
level: "task"
title: "ndx init stops writing local-scope MCP registrations by default and never removes user-scope entries"
status: "pending"
priority: "high"
tags:
  - "pr-03"
  - "core"
blockedBy:
  - "97fbaef0-3691-42b7-9149-70a0bc9aa5b2"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T14:38:11.379Z"
acceptanceCriteria:
  - "Default init makes no `claude mcp add` calls; `--mcp-scope=local` restores them."
  - "No code path calls `claude mcp remove --scope user`."
  - "Unit tests in tests/unit for both modes (mock the claude CLI via the existing shim approach in tests/integration/claude-config-validation.test.js)."
description: "In registerMcpServers (packages/core/claude-integration.js): default to the .mcp.json path from pr3.t1; keep the `claude mcp add --scope local` behaviour behind an explicit --mcp-scope=local flag for people who cannot track .mcp.json; drop the loop that runs `claude mcp remove --scope user` (never touch user scope); when removing stale local-scope entries, only remove ones whose args point at this project directory. Update the init recap output to say where the registration landed."
lastModified: "2026-09-11T16:36:58.329Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
