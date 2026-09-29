---
id: "70ac46e4-b114-48bb-bfcc-d341535309c0"
level: "task"
title: "Back the hench agent model with a real per-vendor override that ndx work honours"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "vendor-aware-hench-config"
  - "pr-n"
blockedBy:
  - "b767dbff-ff4d-4bb5-b75f-fda8655a4fc8"
source: "caos work management: WM-2140 (Back the hench agent model with a real per-vendor override that ndx work honours); 0.8.0 planning, PR 24 · Settings consolidation"
startedAt: "2026-09-29T20:48:14.282Z"
completedAt: "2026-09-29T21:25:39.574Z"
endedAt: "2026-09-29T21:25:39.574Z"
resolutionType: "code-change"
resolutionDetail: "Added hench.models.<vendor>, a per-vendor agent-only model override resolved between --model and all llm.* configuration in ndx work, reported in the vendor/model header as a new \"hench-override\" modelSource. hench.model documented as deprecated and still ignored."
acceptanceCriteria:
  - "With hench.models.<active vendor> set, ndx work runs that model and prints its source; --model still wins."
  - "An override for a vendor other than the active one is ignored."
  - "An override incompatible with the active vendor fails with the same actionable error the configured model gets."
  - "With no override set, the resolved model and its source are exactly as today (regression test)."
  - "hench.model is documented as deprecated and is still ignored."
  - "An invalid hench.models value in .n-dx.json warns and falls back per field (through b767dbff's validation) and does not stop the run."
description: "The hench Model field is dead: ndx work resolves the agent model from --model, then llm-client's task-model resolution for agent.execute (llm.routes, llm.tiers.<vendor>.<tier>, llm.model / llm.<vendor>.model, then the vendor default; run.ts, resolveTaskModel and modelSource), and never reads hench.model. Add an optional per-vendor agent model, hench.models.<vendor> (declared in both the HenchConfig interface in packages/hench/src/schema/v1.ts and HenchConfigSchema in packages/hench/src/schema/validate.ts, as an optional object keyed by vendor — claude, codex, google, local — of non-empty model strings; a key missing from HenchConfigSchema is never validated by b767dbff's re-validation), resolved in run.ts after --model and before all llm.* model configuration (llm.routes, llm.tiers, llm.model and llm.<vendor>.model), for the active vendor only, with the same vendor-compatibility check and error the configured model already gets. Print the source in the vendor/model header as a new \"hench-override\" modelSource; the union lives in packages/llm-client/src/vendor-header.ts, so that is an llm-client change with its own @n-dx/llm-client changeset. Do not add a run-record field. Existing hench.model values (schema default \"sonnet\") stay ignored, so no project changes behaviour on upgrade; document hench.model as deprecated in hench config help (packages/hench/src/cli/help.ts and the config key list in packages/hench/src/cli/commands/config.ts:47). The new key goes through b767dbff's post-merge re-validation, so an invalid hench.models value warns and falls back like any other field. Model-resolution exports come through packages/hench/src/prd/llm-gateway.ts within its export ceiling. Surfacing the override in the dashboard is 94acd4e9 on Robot Wrangler.\n\nMerged from d2981476 (0.7.1 PR N).\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T21:25:39.950Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
