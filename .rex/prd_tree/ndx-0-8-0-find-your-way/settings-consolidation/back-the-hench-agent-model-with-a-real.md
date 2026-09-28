---
id: "70ac46e4-b114-48bb-bfcc-d341535309c0"
level: "task"
title: "Back the hench agent model with a real per-vendor override that ndx work honours"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
source: "caos work management: WM-2140 (Back the hench agent model with a real per-vendor override that ndx work honours); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "ndx work runs the per-vendor agent model when one is set, and resolves exactly as today when none is set (regression test)."
  - "An invalid override in .n-dx.json warns and falls back per field."
description: "The hench Model field is dead: ndx work resolves the model from --model, then llm.<vendor>.model, then the vendor default, and never reads hench.model. Add a per-vendor override (for example hench.models.<vendor>) that ndx work honours after --model and before the project-wide setting. An invalid override in .n-dx.json falls back to the default for that field and warns instead of failing the run. Deferred from 0.7.1; related rex tasks 8559090f, d2981476, 94acd4e9, b767dbff.\n\nImplementation notes: Model resolution is in hench (packages/hench/src/cli/commands/run.ts and the llm-gateway model-resolution exports); add the schema key in packages/hench/src/schema/v1.ts and surface it on Robot Wrangler. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
