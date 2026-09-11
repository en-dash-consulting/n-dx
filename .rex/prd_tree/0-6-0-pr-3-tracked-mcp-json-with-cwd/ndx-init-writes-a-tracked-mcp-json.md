---
id: "97fbaef0-3691-42b7-9149-70a0bc9aa5b2"
level: "task"
title: "ndx init writes a tracked .mcp.json with cwd-relative stdio commands for rex and sourcevision"
status: "pending"
priority: "critical"
tags:
  - "pr-03"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx init` in a fresh temp project produces .mcp.json with exactly the two cwd-relative servers and no absolute path."
  - "Re-running init is idempotent and preserves unrelated servers already in the file."
  - "Verified manually: a Claude Code session opened in a worktree of this repo lists rex and sourcevision tools after approving the project servers."
description: "In packages/core/claude-integration.js, write <projectDir>/.mcp.json as {\"mcpServers\":{\"rex\":{\"command\":\"ndx\",\"args\":[\"rex\",\"mcp\",\".\"]},\"sourcevision\":{\"command\":\"ndx\",\"args\":[\"sv\",\"mcp\",\".\"]}}} using the manifest's server descriptors (getMcpServers()). Merge into an existing .mcp.json without clobbering other servers. Respect cli.name from .n-dx.json when the project embeds n-dx under another binary name (packages/core/cli-identity.js). When `ndx` is not on PATH for a teammate, document the alternative command form (npx -y @n-dx/core rex mcp .) in the README section from pr3.t4 rather than writing absolute paths. Make sure the file is NOT added to the gitignore snippet in packages/hench/src/cli/commands/init.ts or docs/guide/gitignore.md: it is meant to be tracked."
lastModified: "2026-09-10T20:11:42.478Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
