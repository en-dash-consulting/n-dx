---
id: "70ac46e4-b114-48bb-bfcc-d341535309c0"
level: "task"
title: "Back the hench agent model with a real per-vendor override that ndx work honours"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "vendor-aware-hench-config"
  - "pr-n"
blockedBy:
  - "b767dbff-ff4d-4bb5-b75f-fda8655a4fc8"
source: "caos work management: WM-2140 (Back the hench agent model with a real per-vendor override that ndx work honours); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "With hench.models.<active vendor> set, ndx work runs that model and prints its source; --model still wins."
  - "An override for a vendor other than the active one is ignored."
  - "An override incompatible with the active vendor fails with the same actionable error the configured model gets."
  - "With no override set, the resolved model and its source are exactly as today (regression test)."
  - "hench.model is documented as deprecated and is still ignored."
  - "An invalid hench.models value in .n-dx.json warns and falls back per field (through b767dbff's validation) and does not stop the run."
description: "The hench Model field is dead: ndx work resolves the agent model from --model, then llm-client's task-model resolution for agent.execute (llm.routes, llm.tiers.<vendor>.<tier>, llm.model / llm.<vendor>.model, then the vendor default; run.ts, resolveTaskModel and modelSource), and never reads hench.model. Add an optional per-vendor agent model, hench.models.<vendor> (schema key in packages/hench/src/schema/v1.ts), resolved in run.ts after --model and before all llm.* model configuration (llm.routes, llm.tiers, llm.model and llm.<vendor>.model), for the active vendor only, with the same vendor-compatibility check and error the configured model already gets. Record the source on the run and print it (a new \"hench-override\" modelSource). Existing hench.model values (schema default \"sonnet\") stay ignored, so no project changes behaviour on upgrade; document hench.model as deprecated in hench config help. The new key goes through b767dbff's post-merge re-validation, so an invalid hench.models value warns and falls back like any other field. Model-resolution exports come through packages/hench/src/prd/llm-gateway.ts within its export ceiling. Surfacing the override in the dashboard is 94acd4e9 on Robot Wrangler.\n\nMerged from d2981476 (0.7.1 PR N).\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:29:22.354Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
