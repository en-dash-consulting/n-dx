---
id: "8559090f-1578-4e89-90de-b726fb976f6f"
level: "task"
title: "Serve one per-vendor model catalog and use it in the LLM Provider view"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "vendor-aware-hench-config"
  - "pr-n"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "One server response lists models per vendor, derived from llm-client's catalog for claude, codex and google and from the live local server for local; an unreachable local server yields an empty local list with a reason, not an error."
  - "The LLM Provider view's model suggestions come from that response; MODEL_SUGGESTIONS is removed."
  - "A unit test fails if a model in llm-client's tier catalog is missing from the response."
description: "Add a server route (or extend GET /api/llm/config) that returns, for each vendor the project supports (claude, codex, google, local), the models the dashboard should offer: llm-client's catalog (TIER_MODELS / MODEL_COSTS, the same table cost estimates use) for the cloud vendors, and the live /v1/models list from the configured local server for local (routes-llm.ts already probes it for local-status). Replace MODEL_SUGGESTIONS in packages/web/src/viewer/views/llm-provider.ts with that catalog, so the dashboard cannot offer a model id llm-client does not know or miss one it added.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T23:40:51.631Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
