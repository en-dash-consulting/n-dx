---
id: "4aae158d-b99f-4cee-95d0-6ef881912f30"
level: "epic"
title: "Hotfix · #499 MCP servers in desktop worktree sessions write to the main checkout"
status: "pending"
priority: "high"
tags:
  - "hotfix"
  - "mcp"
  - "worktree"
  - "bug"
source: "ndx-capture"
startedAt: "2026-10-05T19:32:15.923Z"
endedAt: "2026-10-05T19:32:15.923Z"
description: "Fixes en-dash-consulting/n-dx#499.\n\nRoot cause, verified 2026-10-05. Claude desktop starts a worktree session with `--project-config-root <repo>`, the main checkout. It spawns the project MCP servers from the tracked .mcp.json (`n-dx rex mcp .`, `n-dx sv mcp .`) with cwd=<repo> and CLAUDE_PROJECT_DIR=<repo>, while the session process itself runs in `<repo>/.claude/worktrees/<name>`. So `.` resolves to the main checkout, and no environment variable names the worktree.\n\nThe fix signal is the MCP roots protocol. Claude Code advertises `capabilities.roots: { listChanged: true }` on initialize, and `roots/list` returns the SESSION's directory, the worktree. A probe server run under the desktop binary with `--project-config-root <repo>` from a worktree recorded cwd=<repo>, CLAUDE_PROJECT_DIR=<repo>, and roots=[file://<repo>/.claude/worktrees/<name>]. Headless `claude -p` from a worktree gets cwd=worktree, so hench runs were never affected.\n\nThree launch paths need it:\n(1) the rex in-process stdio server (packages/rex/src/cli/mcp.ts);\n(2) the sourcevision in-process stdio server (packages/sourcevision/src/cli/mcp.ts);\n(3) the core MCP shim's hub bridge mode (packages/core/mcp-shim.js), which computes X-Ndx-Workspace from cwd. The hub binds an MCP session's workspace at `initialize` (packages/web/src/server/routes-mcp.ts createSession → factory(ctx)), so a header change after initialize does not re-route.\n\nPolicy from the issue: resolve the workspace from the client's roots; when that is impossible, refuse a write rather than silently writing the wrong tree.\n\nConventions (every task in this epic):\n- Branch: fix/499-mcp-worktree-roots, from main.\n- rex and sourcevision never import each other. Shared logic goes in @n-dx/llm-client (foundation). packages/core is orchestration and must not import from packages (tests/e2e/architecture-policy.test.js, tests/e2e/domain-isolation.test.js).\n- Add a patch changeset with SCOPED names (@n-dx/rex, @n-dx/sourcevision, @n-dx/llm-client, @n-dx/core).\n- Run `pnpm test` from the repo root before declaring done. The required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not change .mcp.json or .codex/config.toml. The tracked `n-dx rex mcp .` / `n-dx sv mcp .` command lines stay as they are, and the fix lives in the servers."
lastModified: "2026-10-05T21:02:42.986Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Document that stdio MCP servers follow the client's roots in worktree sessions](./document-that-stdio-mcp-servers-follow.md) | completed |
| [MCP shim bridge mode opens the hub session for the client's worktree from MCP roots](./mcp-shim-bridge-mode-opens-the-hub.md) | completed |
| [Rex stdio MCP server resolves its workspace from the client's MCP roots](./rex-stdio-mcp-server-resolves-its.md) | completed |
| [Sourcevision stdio MCP server resolves its workspace from the client's MCP roots](./sourcevision-stdio-mcp-server-resolves.md) | completed |
| [sv get_overview reports the project name, not the full path, on Windows](./sv-get-overview-reports-the-project.md) | in_progress |
