---
id: "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
level: "task"
title: "Add the Robot Wrangler settings page for provider and model across every LLM-using command"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
source: "caos work management: WM-2119 (Add the Robot Wrangler settings page for provider and model across every LLM-using command); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "A project whose provider and model are still in the old keys loads and displays them; saving writes the new keys."
  - "hench uses the same provider and model the page shows (contract test)."
  - "The page uses the shared Save frame."
description: "Robot Wrangler holds provider and model for every LLM-using command. Until 1.0.0 it must read those keys from both their old and new config locations and write only the new ones.\n\nImplementation notes: Replace packages/web/src/viewer/views/llm-provider.ts with the Robot Wrangler page; do the dual-location read and new-key write in packages/core/config.js (the spawn-exempt config module) and the web config routes (server/routes-llm.ts, server/routes-config.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
