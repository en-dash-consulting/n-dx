---
id: "c1bd1295-f991-4161-ace9-04e7f04bbe66"
level: "task"
title: "Add a state-aware Home view as the dashboard default"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
blockedBy:
  - "22d013f6-b2f5-46e3-a335-91ae32d2e934"
source: "caos work management: WM-2115 (Add a state-aware Home view as the dashboard default); 0.8.0 planning, PR 23 · Navigation and landings"
acceptanceCriteria:
  - "ndx start on a never-analysed project shows Home with the next command, never an empty tool view."
  - "Each of the four states renders from a fixture (unit tests)."
  - "Home is the default route and appears first in the sidebar and rail."
description: "ndx start currently opens on an empty analysis page. Add Home as the default view with four states, each naming the next command: not initialised, initialised but not analysed, analysed without a PRD, PRD present.\n\nImplementation notes: Add a Home view in packages/web/src/viewer/views and register it in views/view-registry.ts; derive the state from existing project-status data (hooks/use-project-status.ts, server routes-status.ts / routes-project.ts) rather than a new endpoint where possible. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
