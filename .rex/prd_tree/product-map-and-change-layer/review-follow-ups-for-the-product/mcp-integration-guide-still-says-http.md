---
id: "df0fe7a7-1995-4f54-bd68-8abcbc0a8595"
level: "task"
title: "MCP Integration guide still says HTTP MCP is single-project until a 0.7.0 hub"
status: "pending"
priority: "medium"
tags:
  - "docs"
source: "ndx-work"
acceptanceCriteria:
  - "docs/guide/mcp.md registers HTTP MCP at /p/<id>/mcp/<server> with the X-Ndx-Token header"
  - "The page no longer says the multi-project hub is upcoming"
  - "`npx vitepress build docs` passes"
description: "Found while rewriting docs/guide/mcp.md for the v2 rex tools (task 4301fba6). The \"HTTP — single project only\" section, the worktree-section note and the \"Migrating from stdio to HTTP\" block register http://localhost:3117/mcp/rex and warn that a multi-project hub lands in 0.7.0. The hub has shipped: per CLAUDE.md, endpoints are http://localhost:3117/p/<id>/mcp/rex, the bare /mcp/rex aliases only while one project is registered (409 otherwise), and every request needs the per-user token (X-Ndx-Token). A reader following the page today registers an endpoint that 409s or 401s once a second project or auth is involved."
lastModified: "2026-10-10T05:54:36.826Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
