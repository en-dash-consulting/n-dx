---
id: "b5d8cf75-346b-40c5-ad1d-07e29a5a855b"
level: "epic"
title: "0.8.0 / PR 14 · MCP shim: ndx mcp <server> . forwards to the hub with the workspace header"
status: "pending"
priority: "medium"
tags:
  - "parallel-dev"
  - "release-0.8.0"
  - "pr-14"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "With the hub running, a Claude Code session in worktree B calling add_item writes to B's tree through the hub and B's dashboard updates live."
  - "With no hub, behaviour is identical to 0.6.0."
  - ".mcp.json and .codex/config.toml are unchanged."
description: "Release 0.8.0 (minor) · PR 14 of 5 · packages: @n-dx/core · changeset: minor · after PR 3 and PR 8.\n\nThe tracked .mcp.json from PR 3 runs `ndx rex mcp .`. Make that command (and `ndx sv mcp .`) a shim: resolve repo and worktree from cwd (git common dir + realpath), derive the project id the same way `ndx start` does (PR 10), and when the hub is alive bridge stdio to Streamable HTTP at /p/<id>/mcp/<server> with an X-Ndx-Workspace header; otherwise run the in-process stdio server against cwd exactly as today. Only something that reads its own cwd can tell the hub which workspace is calling, which is why the tracked file cannot hold a URL.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:34.053Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [ndx mcp shim: cwd → repo + worktree → hub bridge when alive, in-process stdio otherwise](./ndx-mcp-shim-cwd-repo-worktree-hub.md) | pending |
