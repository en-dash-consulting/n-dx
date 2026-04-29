---
id: "64fcec7c-8979-4771-bcb6-9c48edb75cad"
level: "task"
title: "`ndx start` orchestration command"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "dx"
startedAt: "2026-02-10T05:31:42.546Z"
completedAt: "2026-02-10T05:31:42.546Z"
acceptanceCriteria: []
description: "Introduce `ndx start` as the unified entrypoint that starts both the web dashboard and MCP HTTP endpoints on a single port. Supports `--background`, `stop`, `status` (extending the existing `ndx web` pattern). `ndx web` becomes an alias or is deprecated in favor of `ndx start`."
---

## Subtask: Implement `ndx start` command with web + MCP

**ID:** `3e08d89e-3488-4220-b9c8-c5511b6c2be5`
**Status:** completed
**Priority:** high

Add `ndx start` to cli.js that starts the unified server (web dashboard + MCP HTTP endpoints). Supports `--port`, `--background`, `stop`, `status` (same UX as current `ndx web`). Make `ndx web` either an alias for `ndx start` or keep it as web-only for backward compatibility.

**Acceptance Criteria**

- `ndx start .` launches server with dashboard and MCP endpoints
- `ndx start --background .` runs as daemon
- `ndx start stop` and `ndx start status` work
- PID file management works correctly

---

## Subtask: Document MCP HTTP endpoints and update Claude Code config

**ID:** `16b5e4ae-b595-4ac0-9c5a-d2664336540d`
**Status:** completed
**Priority:** medium

Update CLAUDE.md and README with the new `ndx start` workflow. Document how to point Claude Code at the HTTP MCP endpoints instead of stdio (e.g. `claude mcp add rex --transport http --url http://localhost:3117/mcp/rex`). Consider whether `ndx start` should auto-configure this.

**Acceptance Criteria**

- CLAUDE.md documents `ndx start` and MCP HTTP URLs
- Clear migration path from stdio to HTTP MCP

---
