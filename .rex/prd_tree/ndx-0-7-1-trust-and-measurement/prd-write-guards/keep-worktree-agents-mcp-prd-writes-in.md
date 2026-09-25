---
id: "859a814b-4951-4569-aa9d-01e0eccbbedd"
level: "task"
title: "Keep worktree agents' MCP PRD writes in their own worktree when a local-scope registration pins another path"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
  - "pr-j4"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "An autonomous run started in a linked worktree writes PRD changes only to that worktree's .rex, even when a local-scope registration pins the main checkout (integration test with a fake registration)."
  - "ndx init no longer creates an absolute-path local-scope registration, and it reports an existing one with the command to remove it."
  - "The run pre-flight warns when the MCP server the session will use targets a different worktree."
description: "A hench run in ~/ndx-core/n-dx-071-capture (run 0b919f4f) completed WM2042, and the agent's MCP update_task_status wrote the task file in ~/ndx-core/n-dx, the main checkout, on whatever branch it had checked out. Cause: a Claude local-scope MCP registration for the repository (claude mcp add --scope local, the pre-0.7 ndx init path) pins rex and sourcevision to the main checkout's absolute path (node .../packages/rex/dist/cli/index.js mcp /Users/.../n-dx), and Claude Code applies it to sessions started in the repository's other worktrees, shadowing the tracked .mcp.json that resolves '.' per worktree. The per-workspace PRD lock cannot help: the write never reaches the right workspace. Fix candidates: hench's spawned session passes an explicit MCP config (or --strict-mcp-config) naming its own worktree; ndx init stops writing absolute-path local registrations and offers to remove existing ones; ndx doctor or the run pre-flight warns when a registration pins a different worktree.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T23:40:59.460Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
