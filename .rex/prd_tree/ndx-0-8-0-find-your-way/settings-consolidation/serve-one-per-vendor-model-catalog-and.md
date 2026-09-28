---
id: "69848346-1828-42d3-b62d-833648d4274b"
level: "task"
title: "Serve one per-vendor model catalog and offer only the providers each vendor supports on Robot Wrangler"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
source: "caos work management: WM-2139 (Serve one per-vendor model catalog and offer only the providers each vendor supports on Robot Wrangler); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "For every vendor (Claude, Codex, Google, local) the provider choices are exactly what hench accepts."
  - "The model picker lists that vendor's models from one server-side catalog."
  - "The server rejects a provider the vendor does not support."
description: "The hench Config view is Claude-specific: its Provider field offers cli and api for every vendor, although hench allows cli or api for Claude, only cli for Codex, and forces api for Google and local models. Robot Wrangler should serve one per-vendor model catalog (llm-client's catalog for Claude, Codex and Gemini, and the live list from the local server for local models) in place of the list hard-coded in the LLM Provider view, and offer only the providers the active vendor supports, with the server rejecting any other. Deferred from 0.7.1; related rex tasks 8559090f, d2981476, 94acd4e9, b767dbff are to be restored in the 0.8.0 planning pull request.\n\nImplementation notes: Serve the catalog from the web server (server/routes-llm.ts) using llm-client's model catalog through the existing gateways; remove the hard-coded list from packages/web/src/viewer/views/llm-provider.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
