---
id: "b4b18da8-d616-4b2a-919c-4ba2caf7343b"
level: "task"
title: "Move the per-user directory to ~/.ndx/ with NDX_HOME, reading ~/.n-dx/ and N_DX_HOME as fallbacks"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
blockedBy:
  - "1ee864bc-c873-48a1-aedd-657448c3a5e1"
source: "caos work management: WM-2157 (Move the per-user directory to ~/.ndx/ with NDX_HOME, reading ~/.n-dx/ and N_DX_HOME as fallbacks); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
startedAt: "2026-09-29T14:18:09.091Z"
completedAt: "2026-09-29T14:37:22.162Z"
endedAt: "2026-09-29T14:37:22.162Z"
resolutionType: "code-change"
resolutionDetail: "Added resolveNdxHome to the layout resolver (llm-client + the core twin) and routed the hub's registry and core's web.js through it. Lookup: $NDX_HOME, $N_DX_HOME, ~/.ndx if present, ~/.n-dx if present, else ~/.ndx. Pinned in tests/integration/layout-resolver-contract.test.js and packages/web/tests/unit/hub/registry.test.ts; full suite green."
acceptanceCriteria:
  - "With only ~/.n-dx/ present the hub works unchanged."
  - "NDX_HOME overrides the location; N_DX_HOME is honoured when NDX_HOME is unset (tests)."
description: "The per-user directory used by the hub becomes ~/.ndx/ with an NDX_HOME override, reading ~/.n-dx/ and N_DX_HOME as fallbacks.\n\nImplementation notes: Update the hub config loader and registry paths (packages/web/src/hub, ~/.n-dx/config.json) and packages/core/web.js to use the resolver. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T14:37:22.945Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
