---
id: "3c86657a-7fcb-4532-83e3-39655d19b52e"
level: "task"
title: "Enforce feature gates server-side on every token-spending dashboard route"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-22"
blockedBy:
  - "38679536-98a9-4236-b92d-b4500e4b08f3"
source: "caos work management: WM-2124 (Enforce feature gates server-side on every token-spending dashboard route); 0.8.0 planning, PR 22 · Command effects manifest and terminal preflight"
acceptanceCriteria:
  - "Every token-spending dashboard route enforces its feature gate server-side, not only in the nav (tests per route)."
  - "A disabled feature returns a clear error naming the flag."
description: "Some token-spending dashboard routes are gated only in the navigation. Enforce each gate on the server.\n\nImplementation notes: Use the manifest's LLM declarations to enumerate token-spending routes in packages/web/src/server (routes-commands.ts, routes-sourcevision-ask.ts, routes-rex-analysis.ts and others) and check flags from server/routes-features.ts / shared/features.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
