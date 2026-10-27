---
id: "9a09a196-c686-43a2-a55a-d463d36da077"
type: "change"
title: "Add an architecture-policy rule that rejects new literal .rex/, .hench/ and .sourcevision/ paths"
slug: "add-an-architecture-policy-rule-that"
intent: "Once every package uses the resolver, stop new literals from creeping back in.\n\nImplementation notes: Add the rule to tests/e2e/architecture-policy.test.js with an explicit allow-list for the resolver, paths modules and the migrate-layout command. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
acceptanceCriteria:
  - "No literal .rex/, .hench/ or .sourcevision/ path exists outside the resolver and the migration command (policy test)."
  - "The rule fails with the file and line of any new literal."
amends: [{"target":"c81707dc-7c9a-47ba-9043-9a588a87ac76","delta":"modified","summary":"Add an architecture-policy rule that rejects new literal .rex/, .hench/ and .sourcevision/ paths","base":"f4ee69b2318d561e58d5e12dc72bb41f676b34543ec68e9887f0b6c037150f78"}]
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
source: "caos work management: WM-2154 (Add an architecture-policy rule that rejects new literal .rex/, .hench/ and .sourcevision/ paths); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
blockedBy:
  - "f2d76fbb-559b-4008-bfe6-8166034c9b67"
  - "c64f053e-96ef-4fc9-a9b5-f27f0f9cc1f5"
---
