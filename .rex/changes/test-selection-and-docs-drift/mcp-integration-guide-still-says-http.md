---
id: "df0fe7a7-1995-4f54-bd68-8abcbc0a8595"
type: "task"
title: "MCP Integration guide still says HTTP MCP is single-project until a 0.7.0 hub"
slug: "mcp-integration-guide-still-says-http"
description: "Found while rewriting docs/guide/mcp.md for the v2 rex tools (task 4301fba6). The \"HTTP — single project only\" section, the worktree-section note and the \"Migrating from stdio to HTTP\" block register http://localhost:3117/mcp/rex and warn that a multi-project hub lands in 0.7.0. The hub has shipped: per CLAUDE.md, endpoints are http://localhost:3117/p/<id>/mcp/rex, the bare /mcp/rex aliases only while one project is registered (409 otherwise), and every request needs the per-user token (X-Ndx-Token). A reader following the page today registers an endpoint that 409s or 401s once a second project or auth is involved.\n\nOperator note (overnight 2026-10-15): File: docs/guide/mcp.md only. Take the endpoints and auth from the \"MCP Servers\" section of the root CLAUDE.md: `ndx start .` registers the repository with the per-user hub, the endpoints are http://localhost:3117/p/<id>/mcp/rex and .../mcp/sourcevision, the bare /mcp/<server> aliases only while one project is registered (409 listing ids otherwise), every request needs the per-user token from <ndx home>/auth.token as X-Ndx-Token (or Authorization: Bearer, or the ndx_token cookie), registrations use --header \"X-Ndx-Token: $(cat ~/.ndx/auth.token)\", and `ndx start --no-auth` or web.auth: false disables it. Rewrite the HTTP section, the worktree note and the migrate-from-stdio block to match, and drop every \"lands in 0.7.0\" claim. `npx vitepress build docs` must pass; run it before committing. Do not edit README.md, docs/guide/commands.md, docs/cli-ui-gap.md, tests/setup-session-env.js, packages/core/cli.js, help.js, command-effects.js, packages/web, packages/sourcevision, the skills directories (packages/core/assistant-assets/skills/, .claude/skills/) or rex src: other sessions own them tonight. If the fix needs one, stop and say so in your summary. Run the six static root policy tests (tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy) before committing. Do not add a changeset. The hench sandbox pre-approves only npm, npx, node, git, tsc and vitest; never pnpm."
acceptanceCriteria:
  - "docs/guide/mcp.md registers HTTP MCP at /p/<id>/mcp/<server> with the X-Ndx-Token header"
  - "The page no longer says the multi-project hub is upcoming"
  - "`npx vitepress build docs` passes"
priority: "medium"
tags:
  - "docs"
source: "ndx-work"
---
