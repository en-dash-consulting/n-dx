---
id: "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
level: "task"
title: "Add the Robot Wrangler settings page for provider and model across every LLM-using command"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
  - "69848346-1828-42d3-b62d-833648d4274b"
source: "caos work management: WM-2119 (Add the Robot Wrangler settings page for provider and model across every LLM-using command); 0.8.0 planning, PR 24 · Settings consolidation"
startedAt: "2026-09-30T21:36:57.841Z"
completedAt: "2026-09-30T22:19:16.151Z"
endedAt: "2026-09-30T22:19:16.151Z"
resolutionType: "code-change"
resolutionDetail: "RE-SCOPED, then completed against the narrowed scope. The task as written spanned four packages and eight criteria (per-field resolver, three route changes, a CLI migration, an effective-resolution block with a cross-package fixture matrix, and a full viewer rename onto the settings frame) — several PRs of work. Split into three siblings under the same feature: a11c292c (CLI claude.* read+write migration), c3894349 (effective vendor/provider/model block + fixture matrix), 8aedb5db (the Robot Wrangler view, blocked by c3894349). NOTE: mcp__rex__edit_item was not permitted in that session, so this item's own title/description/acceptanceCriteria still read as the original eight-criterion task and should be narrowed by hand to match this resolution.\n\nDelivered: resolveClaudeConfig in @n-dx/llm-client — one implementation of per-field `new ?? old` over llm.claude.* and legacy claude.*, exported with a per-field `sources` map. Wired into loadLLMConfig, GET /api/llm/config (which now returns resolved values plus `claudeSources`, replacing the separate `legacyClaude` block) and GET /api/ndx-config (which also stopped falling back to the dead hench.model, and whose auth check now counts credentials under llm.claude.* — it read only the legacy block before and worked solely because of core's mirror). PUT /api/llm/config refuses claude.model/claude.lightModel with a 400 naming the replacement; both left VALID_PATHS. packages/core/config.js no longer mirrors llm.claude.* into claude.*; existing legacy values are left in place and the local-file secret migration still fires. The existing llm-provider view was updated to read claudeSources so the shipped state stays coherent until 8aedb5db replaces it.\n\nVerification: pnpm build, pnpm typecheck, full suite (20,732 tests, exit 0), obfuscation policy, pr-check, changeset status all green. Commit 46c99b4b."
acceptanceCriteria:
  - "resolveClaudeConfig (@n-dx/llm-client) resolves claude.model, lightModel, cli_path, api_key and api_endpoint as llm.claude.<field> ?? claude.<field>. loadLLMConfig, loadClaudeConfig, GET /api/llm/config (with claudeSources) and GET /api/ndx-config use it, and routes-config no longer falls back to hench.model (unit tests: old-only, new-only, both)."
  - "PUT /api/llm/config rejects claude.model and claude.lightModel with a 400 naming the llm.claude.* replacement. packages/core/config.js no longer mirrors llm.claude.* into claude.*, and existing claude.* values are left in place."
  - "A patch changeset for @n-dx/llm-client, @n-dx/web and @n-dx/core states the per-field behaviour change."
  - "The rest of the original scope is a11c292c (CLI claude.* reads and writes), c3894349 (effective block and contract test) and 8aedb5db (the Robot Wrangler view, the /llm-provider redirect and the frame)."
description: "Robot Wrangler holds provider and model for every LLM-using command. Until 1.0.0 it must read those keys from both their old and new config locations and write only the new ones.\n\nImplementation notes: Replace packages/web/src/viewer/views/llm-provider.ts with the Robot Wrangler page; do the dual-location read and new-key write in packages/core/config.js (the spawn-exempt config module) and the web config routes (server/routes-llm.ts, server/routes-config.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T22:44:00.871Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
