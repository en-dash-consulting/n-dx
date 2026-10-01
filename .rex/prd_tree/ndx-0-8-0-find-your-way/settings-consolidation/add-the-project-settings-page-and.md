---
id: "031b844a-8238-4ae8-8641-314b33c3ce8f"
level: "task"
title: "Add the Project settings page and relabel the Commands settings entry"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "2fa5da62-773b-48d9-bcd6-8aaa6011b465"
  - "22226abd-53df-411b-803a-4f96e0325356"
source: "caos work management: WM-2121 (Add the Project settings page and move the export and refresh panels to Commands); 0.8.0 planning, PR 24 · Settings consolidation"
acceptanceCriteria:
  - "Project is a new settings view, id project, label \"Project\", in packages/web/src/viewer/views/project.ts. It replaces project-settings, feature-toggles, notion-config and integrations in SETTINGS_ENTRIES, in project-settings' position, and in VIEW_META, the view registry, ViewId and the scope lists. project is in CROSS_CUTTING_VIEWS, so it is valid in the rex-scoped viewer. The four old view files are deleted or reduced to section components the page imports."
  - "The whole page renders inside exactly one SettingsFrame. No section mounts its own frame, save bar or toast: hooks/use-leave-guard.ts holds one module-level guard, and unmounting any frame clears it. dirty is true when any section differs from its saved values. One Save sends each dirty section to its existing endpoint (PUT /api/project-settings, PUT /api/features, PUT /api/notion/config, PUT /api/integrations/<id>/config). If any save fails, the sections that saved become clean, the failed ones stay dirty and the frame shows the error. Discard restores every section."
  - "Feature toggles save on Save, not on click, and feature-toggle-changed is dispatched for each changed key only after its save succeeds. The Notion and Integrations sections appear only while rex.notionSync or rex.integrations is on, as their overlay entries did. Immediate actions (Notion test, sync and disconnect; integration remove) stay immediate buttons and do not change dirty state."
  - "/project-settings, /feature-toggles, /notion-config and /integrations redirect to /project through VIEW_ALIASES. Each pair is added to ALIASES in tests/e2e-ui/navigation.spec.ts and to tests/unit/server/redirect-aliases.test.ts, with a rex-scoped case showing /notion-config redirects to /project there."
  - "The export and refresh panels stay in views/commands.ts and nowhere on the Project page (already true at the B6a tip). The commands settings entry stays in settings, relabelled \"Commands\" (VIEW_META label today: \"{cli} export / refresh\") with the blurb \"Run refresh, export, the sample app and self-heal from the dashboard.\" Moving it out of settings into the Commands sheet is GitHub issue #464, not this task."
  - "tests/unit/viewer/project-page.test.ts covers: exactly one .settings-frame; combined dirty; a multi-endpoint Save that succeeds; one that partly fails; Discard. Existing shell/navigation tests are updated, including axe-audit.test.ts (the ProjectSettingsView imports at :809 and :818), the label list in shell.test.ts:639 and the project-settings row in docs/accessibility.md. tests/layout-literal-inventory.md is updated in the same commit (a deleted file's row is removed, and a moved literal takes its row with it; the total never rises). A changeset bumps @n-dx/web as patch."
description: "Project holds analyze and plan settings, feature flags and integrations. The export and refresh panels already render only in views/commands.ts (RefreshPanel and ExportPanel); nothing moves.\n\nImplementation notes: Merge packages/web/src/viewer/views/project-settings.ts, views/feature-toggles.ts, views/integration-config.ts and views/notion-config.ts into the Project page. The export and refresh panels already render only in views/commands.ts (RefreshPanel and ExportPanel); nothing moves. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-01T01:43:23.850Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
