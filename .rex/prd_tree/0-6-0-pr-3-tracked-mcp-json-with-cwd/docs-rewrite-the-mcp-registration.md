---
id: "9f0a2b51-beab-4984-b68d-96e3c33ca93a"
level: "task"
title: "Docs: rewrite the MCP registration section; mark HTTP registration as single-project"
status: "completed"
priority: "medium"
tags:
  - "pr-03"
  - "docs"
blockedBy:
  - "97fbaef0-3691-42b7-9149-70a0bc9aa5b2"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T14:41:42.116Z"
completedAt: "2026-09-11T17:20:54.697Z"
endedAt: "2026-09-11T17:20:54.697Z"
acceptanceCriteria:
  - "README, generated AGENTS.md and CLAUDE.md describe the .mcp.json flow and the HTTP caveat."
  - "No doc still instructs `claude mcp add --scope local` as the default."
description: "README.md MCP section and packages/core/assistant-assets (project-guidance.md, claude-addendum.md, codex-troubleshooting.md as relevant): describe .mcp.json as the default, the one-time Claude Code approval prompt for project servers, the npx alternative when ndx is not on PATH, and --mcp-scope=local. State plainly that the HTTP registration on http://localhost:3117/mcp/rex points at whichever project holds the port and is only safe with a single project until the hub (0.7.0) lands. Re-run `ndx init` on this repo so AGENTS.md / CLAUDE.md regenerate from the shared source, and commit the regenerated files."
lastModified: "2026-09-11T17:20:54.704Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
