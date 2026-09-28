---
id: "1ee864bc-c873-48a1-aedd-657448c3a5e1"
level: "task"
title: "Add a layout resolver in core and a paths module per package that read .ndx/ first and fall back to the legacy layout"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-20"
source: "caos work management: WM-2151 (Add a layout resolver in core and a paths module per package that read .ndx/ first and fall back to the legacy layout); 0.8.0 planning, PR 20 · Layout resolver and path sweep"
startedAt: "2026-09-28T19:09:23.372Z"
acceptanceCriteria:
  - "The resolver returns .ndx/ paths when present and legacy paths otherwise, with no warning (tests)."
  - "Each package has a paths module that is the only place its folder names appear."
description: "n-dx keeps its files in three root folders (.rex, .hench, .sourcevision), five loose .n-dx* files and ~/.n-dx for the hub, and roughly 380 source files name those paths directly. Introduce one layout resolver and a paths module per package so no code names a folder directly. The resolver reads .ndx/ first and falls back to the legacy layout silently.\n\nImplementation notes: Add the resolver in packages/core and per-package paths modules; packages/rex/src/store/paths.ts already centralises the PRD tree names and is the model to extend. Domain packages cannot import core, so each package's paths module must implement the same lookup order (a shared helper can live in @n-dx/llm-client, the foundation tier). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T20:47:04.385Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
