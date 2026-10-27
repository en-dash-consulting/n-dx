---
id: "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
type: "task"
title: "Add the Robot Wrangler settings page for provider and model across every LLM-using command"
slug: "add-the-robot-wrangler-settings-page"
description: "Robot Wrangler holds provider and model for every LLM-using command. Until 1.0.0 it must read those keys from both their old and new config locations and write only the new ones.\n\nImplementation notes: Replace packages/web/src/viewer/views/llm-provider.ts with the Robot Wrangler page; do the dual-location read and new-key write in packages/core/config.js (the spawn-exempt config module) and the web config routes (server/routes-llm.ts, server/routes-config.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
acceptanceCriteria:
  - "resolveClaudeConfig (@n-dx/llm-client) resolves claude.model, lightModel, cli_path, api_key and api_endpoint as llm.claude.<field> ?? claude.<field>. loadLLMConfig, loadClaudeConfig, GET /api/llm/config (with claudeSources) and GET /api/ndx-config use it, and routes-config no longer falls back to hench.model (unit tests: old-only, new-only, both)."
  - "PUT /api/llm/config rejects claude.model and claude.lightModel with a 400 naming the llm.claude.* replacement. packages/core/config.js no longer mirrors llm.claude.* into claude.*, and existing claude.* values are left in place."
  - "A patch changeset for @n-dx/llm-client, @n-dx/web and @n-dx/core states the per-field behaviour change."
  - "The rest of the original scope is a11c292c (CLI claude.* reads and writes), c3894349 (effective block and contract test) and 8aedb5db (the Robot Wrangler view, the /llm-provider redirect and the frame)."
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
source: "caos work management: WM-2119 (Add the Robot Wrangler settings page for provider and model across every LLM-using command); 0.8.0 planning, PR 24 · Settings consolidation"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
  - "69848346-1828-42d3-b62d-833648d4274b"
---
