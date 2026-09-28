---
id: "031b844a-8238-4ae8-8641-314b33c3ce8f"
level: "task"
title: "Add the Project settings page and move the export and refresh panels to Commands"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
source: "caos work management: WM-2121 (Add the Project settings page and move the export and refresh panels to Commands); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "Analyze/plan settings, feature flags and integrations (including Notion) are on one page with the shared Save frame."
  - "Export and refresh panels render on Commands and nowhere in settings."
description: "Project holds analyze and plan settings, feature flags and integrations. The export and refresh action panels move to the Commands page.\n\nImplementation notes: Merge packages/web/src/viewer/views/project-settings.ts, views/feature-toggles.ts, views/integration-config.ts and views/notion-config.ts into the Project page; move the export/refresh panels into views/commands.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
