---
id: "775f745b-ea30-4160-bbc4-82a660664cae"
level: "task"
title: "Dynamic port allocation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T02:16:16.768Z"
completedAt: "2026-02-18T02:16:16.768Z"
acceptanceCriteria: []
description: "Automatically find and use an available port when the default port 3117 is already in use"
---

## Subtask: Implement dynamic port allocation with fallback logic

**ID:** `70ba2552-c667-4ae9-9656-f16bfe2b8935`
**Status:** completed
**Priority:** high

Add port availability detection and modify web server initialization to use fallback ports when the configured port is unavailable

**Acceptance Criteria**

- Detects when port 3117 is already in use
- Finds the next available port in range 3117-3200
- Returns port availability status and suggested port
- Handles network permission errors gracefully
- Tries configured port first (3117 by default)
- Falls back to next available port if configured port is taken
- Logs clear message about port change to user
- Updates internal server state with actual port used
- Continues startup without failing

---

## Subtask: Update MCP endpoints and orchestration with dynamic port support

**ID:** `bc25f789-9435-4263-a9a1-3269c324c444`
**Status:** completed
**Priority:** high

Ensure MCP HTTP endpoints and ndx start command reflect the actual port used by the server and handle port conflicts gracefully

**Acceptance Criteria**

- MCP endpoints use actual server port in URLs
- Documentation commands show correct port in output
- Claude Code configuration instructions reflect actual port
- Port changes are communicated clearly to user
- ndx start command doesn't fail when port 3117 is taken
- Displays clear message showing actual port used
- Updates any generated configuration with correct port
- Provides updated Claude Code MCP setup instructions

---
