---
id: "cce8f62c-8660-4157-9dd2-722a64baa62b"
level: "task"
title: "Price dashboard token usage per model and show the split"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "cost-measurement"
  - "wm-2051"
blockedBy:
  - "2b86bc48-6cab-4cd1-bc15-b05ee38fc14d"
source: "caos work management: WM2051 (Price dashboard token usage per model and show the split); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "For a fixture set of runs across two models, the dashboard total equals the `ndx usage` total to the cent."
  - "The Token Usage view shows a per-model row (input, output, cache write, cache read, cost) and a total."
  - "Runs whose model has no pricing entry are labelled 'unpriced' and excluded from the cost total rather than priced at a default."
  - "packages/rex/tests/fixtures/token-usage-regression.json is reused as the dashboard test fixture."
description: "packages/web/src/server/routes-token-usage.ts prices every run at one default Sonnet rate (DEFAULT_PRICING), so dashboard costs are wrong for any other model and disagree with `ndx usage`, which PR #353 moves to per-model pricing (packages/llm-client/src/model-pricing.ts and packages/rex/src/core/token-usage.ts). Make the dashboard use the same per-model pricing through its gateways and show the per-model split in the Token Usage view, so both surfaces report the same number for the same runs.\n\nImplementation notes: After PR #353 is merged, replace DEFAULT_PRICING in packages/web/src/server/routes-token-usage.ts with the per-model pricing and aggregation that rex's core/token-usage.ts and llm-client's model-pricing.ts provide, importing only through packages/web/src/server/rex-gateway.ts and domain-gateway.ts (raise the export ceiling in tests/e2e/architecture-policy.test.js as needed). Return a per-model breakdown from the route and render it as rows in the Token Usage view (packages/web/src/viewer). Treat unknown models as unpriced rather than defaulting. Add a server unit test using packages/rex/tests/fixtures/token-usage-regression.json asserting equality with the rex rollup. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:19.785Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
