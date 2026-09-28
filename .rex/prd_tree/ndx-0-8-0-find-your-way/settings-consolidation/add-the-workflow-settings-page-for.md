---
id: "22226abd-53df-411b-803a-4f96e0325356"
level: "task"
title: "Add the Workflow settings page for work settings, templates and timeouts"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
source: "caos work management: WM-2120 (Add the Workflow settings page for work settings, templates and timeouts); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "Work settings, templates and timeouts are editable on one page with the shared Save frame."
  - "Values round-trip to the same config files as before (tests)."
description: "Workflow holds the ndx work settings, hench templates and CLI timeouts that are currently spread across three views.\n\nImplementation notes: Merge packages/web/src/viewer/views/hench-config.ts, views/hench-templates.ts and views/cli-timeout.ts into the Workflow page; keep the existing server routes (server/hench-config-fields.ts, server/routes-cli-timeout.ts). Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
