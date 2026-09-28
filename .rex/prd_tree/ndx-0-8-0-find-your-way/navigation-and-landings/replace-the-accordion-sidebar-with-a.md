---
id: "22d013f6-b2f5-46e3-a335-91ae32d2e934"
level: "task"
title: "Replace the accordion sidebar with a shared navigation model, always-open groups and a collapsed rail"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
source: "caos work management: WM-2113 (Replace the accordion sidebar with a shared navigation model, always-open groups and a collapsed rail); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "The sidebar renders 7 groups and 24 items with no expand-one-at-a-time behaviour."
  - "The collapsed rail shows Home, Flight Deck and the SourceVision, Rex and Hench icons."
  - "Sidebar and landing cards read the same model (unit test asserts one source)."
  - "Keyboard and screen-reader navigation work in both expanded and collapsed states (existing a11y harness)."
description: "The sidebar is a hardcoded 33-item accordion that opens one section at a time. Replace it with one navigation data model (group, item, view id, icon, landing-card copy) that both the sidebar and the new landing pages read, render every group open, and add a collapsed rail showing Home, Flight Deck and the three package icons.\n\nImplementation notes: Introduce the navigation model in packages/web/src/viewer (a new module beside views/view-registry.ts) and rebuild components/sidebar.ts on it. Keep every existing view id registered in views/view-registry.ts so no view is orphaned. Match styles/tokens.css and styles/layout.css. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
