---
id: "87f0f9dc-d491-4fa5-bbf5-d039a5405fce"
level: "task"
title: "Carry the hold reason into the dashboard claims payload and the Execute 409"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "claims-hardening"
  - "pr-e"
  - "audit-2026-09-23"
source: "0.7.1 release audit 2026-09-23 (main @ ee165780)"
acceptanceCriteria:
  - "GET /api/rex/claims entries include reason when a claim is held, and omit it otherwise (additive, optional)."
  - "The Execute 409 for a held task says it is held for uncommitted work and names ndx claim release <id>; a live claim keeps today's wording."
  - "The PRD tree's claim chip distinguishes a held claim from a running one."
  - "Unit tests cover both payloads."
description: "The claim data the dashboard receives (`packages/web/src/server/routes-rex/reads.ts:29-43`) and the Execute route's 409 (`routes-hench.ts`, near 1449) both omit the claim's `reason`. A hold left by a finished run therefore looks like a live run, and the 409 says the task \"is being worked on\".\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:39:55.136Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
