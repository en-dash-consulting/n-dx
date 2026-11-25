---
"@n-dx/core": patch
---

`ndx init` now writes a short CLAUDE.md and AGENTS.md about using n-dx in your repository, instead of n-dx's own monorepo guidance.

The new guidance covers what rex, sourcevision and hench are for, where the PRD and analysis live in your layout, the MCP servers and their main tools, the `ndx` commands to reach for, and that code changes go through `ndx work`. A fresh project's CLAUDE.md drops from about 260 lines to about 50.

Only an n-dx checkout, recognised by its `packages/core/assistant-assets/project-guidance.md`, still gets the monorepo guidance. No config setting selects it.
