---
id: "c1bd1295-f991-4161-ace9-04e7f04bbe66"
level: "task"
title: "Add a next-step panel with four project states to the Home landing"
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
  - "On a never-analysed project, / lands on /home and Home names the next command in a next-step panel above the three stage cards; no stage or tool view is shown instead."
  - "Each of the four states (not initialised, initialised but not analysed, analysed without a PRD, PRD present) renders its command from an /api/status fixture in unit tests beside the HomeView tests in tests/unit/viewer/shell.test.ts."
  - "Commands use the resolved CLI name, and the PRD-present state shows the next task's title."
  - "useProjectStatus checks the /api/status body's shape once, in fetchStatus, and treats a body with a missing or malformed section (for example rex.stats = {}) as unavailable; a unit test feeds such a body and Home still renders."
  - "The existing HomeView unit tests and the navigation.spec.ts 'a bare URL lands on home' test still pass."
description: "#425 made /home the default route (hooks/use-route-state.ts defaultView) with three stage cards (views/stage-pages.ts HomeView), but Home does not say what to do next: on a never-analysed project the cards show dashes. Add a next-step panel above the stage cards with four states, each naming the next command: not initialised (init), initialised but not analysed (analyze), analysed without a PRD (plan), PRD present (the next task's title and work). Keep the three stage cards.\n\nImplementation notes: Derive the state from useProjectStatus (/api/status: sv.freshness, rex.exists, rex.nextTaskTitle, hench.configured) rather than a new endpoint. If those fields cannot tell 'not initialised' from 'not analysed', add one boolean to the /api/status response in server/routes-status.ts with a unit test, and change nothing else under src/server/. Resolve the CLI name with useCliName and resolveCliLabel instead of hardcoding ndx. Leave a slot below the panel for A8's preflight card. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T15:50:51.716Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
