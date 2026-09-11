---
id: "b66dc09e-fda6-4f1e-a5df-a21e0362ce1e"
level: "epic"
title: "0.6.0 / PR 3 · Tracked .mcp.json with cwd-relative MCP commands"
status: "pending"
priority: "critical"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-03"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "After `ndx init`, .mcp.json exists at the repo root with cwd-relative commands and no absolute paths, and Claude Code offers rex and sourcevision tools from any worktree of the repo."
  - "`ndx init` no longer writes local-scope entries by default and never touches user scope."
  - ".codex/config.toml contains no absolute paths."
description: "Release 0.6.0 (minor) · PR 3 of 7 · packages: @n-dx/core · changeset: minor.\n\nProblem. `ndx init` registers MCP servers with `claude mcp add --scope local <name> -- node <abs dist path> mcp <abs project dir>` (packages/core/claude-integration.js registerMcpServers, ~lines 187–235) and writes the same absolute paths into .codex/config.toml (packages/core/codex-integration.js writeCodexConfig). Local scope is stored in ~/.claude.json keyed by the absolute project path, so worktrees get no MCP at all, teammates get nothing, and the registration breaks when the install moves or the dev link toggles. Init also removes the names from every scope, including user scope.\n\nGoal. One tracked .mcp.json at the repo root with cwd-relative stdio commands (`ndx rex mcp .` and `ndx sv mcp .`; rex's mcp command already resolves its directory positional relative to cwd, see packages/rex/src/cli/index.js case \"mcp\"). Claude Code launches project-scope stdio servers with cwd at the checkout root, so every worktree and teammate gets the right tree. PR 14 later upgrades the same command into a hub-aware shim without changing the file.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:11:41.638Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Codex .codex/config.toml uses the same cwd-relative MCP commands](./codex-codex-config-toml-uses-the-same.md) | pending |
| [Docs: rewrite the MCP registration section; mark HTTP registration as single-project](./docs-rewrite-the-mcp-registration.md) | pending |
| [ndx init stops writing local-scope MCP registrations by default and never removes user-scope entries](./ndx-init-stops-writing-local-scope-mcp.md) | pending |
| [ndx init writes a tracked .mcp.json with cwd-relative stdio commands for rex and sourcevision](./ndx-init-writes-a-tracked-mcp-json.md) | pending |
| [Tests: init writes .mcp.json; generated MCP configs contain no absolute paths](./tests-init-writes-mcp-json-generated.md) | pending |
