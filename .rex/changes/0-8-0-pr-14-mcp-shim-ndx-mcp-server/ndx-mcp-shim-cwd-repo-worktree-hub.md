---
id: "99f752e7-487c-4447-b0e7-0636224705b2"
type: "task"
title: "ndx mcp shim: cwd → repo + worktree → hub bridge when alive, in-process stdio otherwise"
slug: "ndx-mcp-shim-cwd-repo-worktree-hub"
description: "packages/core/mcp-shim.js (orchestration tier: node built-ins only; the in-process fallback spawns the sub-package CLI exactly as `ndx rex mcp .` does today). Bridge: read JSON-RPC frames from stdin, POST them to http://127.0.0.1:<hubPort>/p/<id>/mcp/<server> with Mcp-Session-Id persisted per process and X-Ndx-Workspace: <worktree key>; stream SSE responses back to stdout as newline-delimited JSON; handle notifications and the session DELETE on exit. Fallback when the hub health check fails or the project is not registered (optionally auto-register when hub is alive but project absent). Log to stderr only. Timeouts and reconnect once."
acceptanceCriteria:
  - "Integration test with a fake hub: frames round-trip with the workspace header; hub down → in-process path (existing rex mcp tests)."
  - "Claude Code manual verification from two worktrees documented in the PR description."
priority: "medium"
tags:
  - "pr-14"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
blockedBy:
  - "97fbaef0-3691-42b7-9149-70a0bc9aa5b2"
  - "1519783b-dcd6-43d2-b166-e410aef4c3ce"
  - "3ef3366c-7d84-4f33-a0e0-3f9c3f368e61"
---
