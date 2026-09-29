---
id: "69848346-1828-42d3-b62d-833648d4274b"
level: "task"
title: "Serve one per-vendor model catalog and the provider choices each vendor supports from the web server"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "vendor-aware-hench-config"
  - "pr-n"
blockedBy: []
source: "caos work management: WM-2139 (Serve one per-vendor model catalog and offer only the providers each vendor supports on Robot Wrangler); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "One server response lists, for every vendor (claude, codex, google, local), the models to offer and the provider choices, and the provider choices are exactly what hench accepts: claude cli or api, codex cli only, google api, local api."
  - "Cloud-vendor models come from llm-client's catalog; a unit test fails if a model in llm-client's TIER_MODELS catalog is missing from the response."
  - "Local models come from the configured local server's live /v1/models list; an unreachable local server returns an empty local list with a reason, not an error."
  - "The server rejects saving a hench provider the active vendor does not support, with an error naming the vendor and the allowed providers."
  - "No viewer files change; web does not import hench."
description: "The dashboard's model lists are hard-coded in the viewer (packages/web/src/viewer/views/llm-provider.ts, MODEL_SUGGESTIONS) and can drift from llm-client's catalog, and nothing on the server says which providers each vendor supports: hench allows cli or api for Claude, only cli for Codex (it refuses api), and forces api for Google and local (packages/hench/src/cli/commands/run.ts, provider resolution).\n\nServer side only. Add a route in packages/web/src/server/routes-llm.ts (or extend GET /api/llm/config) that returns, for each vendor (claude, codex, google, local), the models to offer and the provider choices hench accepts. Cloud-vendor models come from llm-client's catalog (TIER_MODELS and MODEL_COSTS in packages/llm-client/src/config.ts, the table cost estimates use). Local models come from the configured local server's live /v1/models list (routes-llm.ts already probes it for /api/llm/local-status). The dashboard's hench config save path rejects a provider the vendor does not support. Web imports @n-dx/llm-client directly, as other server modules do; web must not import hench, so a root contract test (tests/integration/cross-package-contracts.test.js) pins the provider table to what hench accepts. No viewer changes: the picker UI and the removal of MODEL_SUGGESTIONS belong to 94acd4e9 on Robot Wrangler.\n\nMerged from 8559090f (0.7.1 PR N), whose viewer half moved to 94acd4e9.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:29:20.123Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
