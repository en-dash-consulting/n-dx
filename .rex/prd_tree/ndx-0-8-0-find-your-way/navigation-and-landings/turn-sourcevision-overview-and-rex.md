---
id: "c2a7f1e7-0935-4573-a5d4-86749cccfa51"
level: "task"
title: "Turn SourceVision Overview and Rex Dashboard into package landing pages, add a Hench landing, and move Rex execution panels to the Flight Deck"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
blockedBy:
  - "22d013f6-b2f5-46e3-a335-91ae32d2e934"
source: "caos work management: WM-2116 (Turn SourceVision Overview and Rex Dashboard into package landing pages, add a Hench landing, and move Rex execution panels to the Flight Deck); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "SourceVision, Rex and Hench each have a landing page with cards generated from the navigation model."
  - "Rex execution panels render on the Flight Deck and no longer on the Rex landing."
  - "Old view ids for Overview and Rex Dashboard still resolve (via the redirects from the contract task)."
description: "Each package gets a landing page that explains what it does and links to its views, built from the shared navigation model. Rex's execution panels move out of the Rex Dashboard to the Flight Deck.\n\nImplementation notes: Rework packages/web/src/viewer/views/overview.ts and views/rex-dashboard.ts into landings, add a Hench landing next to views/hench-runs.ts, and move the execution panel components (components/prd-tree/execution-panel.ts and related) to the Flight Deck view. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
