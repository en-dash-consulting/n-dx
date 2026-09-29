---
id: "2c1bbdff-8e48-4769-9f4b-f2c59a2c54fe"
level: "task"
title: "Make ndx init write the .ndx/ layout for new projects"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-21"
blockedBy:
  - "1ee864bc-c873-48a1-aedd-657448c3a5e1"
source: "caos work management: WM-2155 (Make ndx init write the .ndx/ layout for new projects); 0.8.0 planning, PR 21 · Layout: init and migrate-layout"
startedAt: "2026-09-29T15:35:01.345Z"
acceptanceCriteria:
  - "A fresh ndx init produces .ndx/ and .mcp.json only."
  - "Existing projects re-running init keep their current layout."
description: "New projects start on the target layout.\n\nImplementation notes: Update packages/core/cli.js init orchestration and the package init commands (packages/rex/src/cli/commands/init.ts, packages/hench/src/cli/commands/init.ts) to ask the resolver for target paths; .mcp.json stays at the repository root because the vendor CLIs read it there. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T15:35:02.214Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
