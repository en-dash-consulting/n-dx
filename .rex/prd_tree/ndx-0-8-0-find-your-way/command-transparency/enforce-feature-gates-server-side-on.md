---
id: "3c86657a-7fcb-4532-83e3-39655d19b52e"
level: "task"
title: "Enforce feature gates server-side on every token-spending dashboard route"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-22"
blockedBy:
  - "38679536-98a9-4236-b92d-b4500e4b08f3"
source: "caos work management: WM-2124 (Enforce feature gates server-side on every token-spending dashboard route); 0.8.0 planning, PR 22 · Command effects manifest and terminal preflight"
startedAt: "2026-09-29T14:58:04.536Z"
completedAt: "2026-09-29T15:16:13.619Z"
endedAt: "2026-09-29T15:16:13.619Z"
resolutionType: "code-change"
resolutionDetail: "Added packages/web/src/server/route-feature-gates.ts — a declarative inventory of which dashboard endpoint each feature toggle governs — and called enforceRouteFeatureGate at the top of handleApiRoutes in start.ts, so a disabled feature answers 403 naming the flag before dispatch. Closed the real gap: sourcevision.ask (the one toggle over a token-spending endpoint) previously left /api/rex/capture-ask and /api/rex/apply-refinements reachable; sourcevision.prMarkdown, rex.notionSync and rex.integrations were nav-only. The ask endpoint itself keeps its own gate (shaped kind:\"disabled\" body the panel renders) and is marked selfEnforced. Tests: tests/unit/server/route-feature-gates.test.ts (per-endpoint refuse/pass, flag named in body and prose, fail-closed on unreadable .n-dx.json, plus a completeness test that fails if a sidebar featureGate has no server entry) and tests/integration/feature-gate-enforcement.test.ts (real server via child driver, proving the chokepoint is on the dispatch path). Changeset .changeset/server-side-feature-gates.md, @n-dx/web patch. Committed as 9678068e."
acceptanceCriteria:
  - "Every token-spending dashboard route enforces its feature gate server-side, not only in the nav (tests per route)."
  - "A disabled feature returns a clear error naming the flag."
description: "Some token-spending dashboard routes are gated only in the navigation. Enforce each gate on the server.\n\nImplementation notes: Use the manifest's LLM declarations to enumerate token-spending routes in packages/web/src/server (routes-commands.ts, routes-sourcevision-ask.ts, routes-rex-analysis.ts and others) and check flags from server/routes-features.ts / shared/features.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T15:16:15.943Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
