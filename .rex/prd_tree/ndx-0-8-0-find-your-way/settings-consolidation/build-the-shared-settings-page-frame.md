---
id: "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
level: "task"
title: "Build the shared settings page frame with explicit Save, a dirty indicator and redirects for the six old settings routes"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "e8fb5412-e393-4e24-a104-8b14194066d1"
source: "caos work management: WM-2118 (Build the shared settings page frame with explicit Save, a dirty indicator and redirects for the six old settings routes); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "/llm-provider, /hench-config, /project-settings, /feature-toggles, /cli-timeouts and /notion-config redirect to the three new pages."
  - "Unsaved changes show a dirty indicator and navigating away prompts."
  - "Unit tests cover dirty tracking, Save and the leave prompt."
description: "Six settings routes become three pages. First build the shared frame they use: explicit Save, an unsaved-changes indicator, a prompt when navigating away with unsaved changes, and redirects from the old routes.\n\nImplementation notes: Add the frame as a shared component in packages/web/src/viewer/components and register the redirects through the alias table added for navigation (packages/web/src/shared/view-routing.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
