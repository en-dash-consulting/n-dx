---
id: "fdfe2a6d-fffa-474a-98b6-464671f77a62"
level: "task"
title: "Document that stdio MCP servers follow the client's roots in worktree sessions"
status: "in_progress"
priority: "medium"
tags:
  - "docs"
  - "mcp"
  - "worktree"
blockedBy:
  - "e07c43d4-065b-481d-b996-dad39da83d26"
  - "fdfca018-9adf-441c-80fc-dd22994f1ac1"
  - "99aea49e-110e-4d42-a4da-879c14ad508c"
source: "ndx-capture"
startedAt: "2026-10-05T19:22:50.482Z"
acceptanceCriteria:
  - "The shared guidance source (packages/core/assistant-assets/project-guidance.md and/or claude-addendum.md) states that stdio rex/sv servers resolve their workspace from the client's MCP roots, which fixes desktop worktree sessions whose servers start in the main checkout, and that writes are refused rather than misrouted when the client's worktree cannot be served."
  - "CLAUDE.md and AGENTS.md are regenerated from the assets (no hand edits), and the concurrency-contract paragraph about per-worktree PRD locks mentions MCP sessions."
  - "README.md MCP section and docs/ pages describing `ndx mcp` / the shim mention roots-based worktree resolution and the get_capabilities workspace block for verifying it."
  - "Asset drift tests pass (`pnpm test`)."
description: "After the three code tasks land, document the behaviour.\nFind the sources with `grep -rn \"rex mcp \\.\" packages/core/assistant-assets README.md docs`.\nDo not hand-edit generated CLAUDE.md / AGENTS.md: edit the assets and regenerate them the way the repo's drift tests expect (see packages/core/assistant-assets.js and the tests that compare generated output).\nNote for operators: verify a session's write target with the rex `get_capabilities` tool (workspace.source should read 'roots' in a desktop worktree session).\nChangeset: fold into @n-dx/core patch if assets change."
lastModified: "2026-10-05T19:22:50.891Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
