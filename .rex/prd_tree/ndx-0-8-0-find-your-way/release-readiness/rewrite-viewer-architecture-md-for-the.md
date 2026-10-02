---
id: "343f075c-2314-4861-80d1-7b5e53e56861"
level: "task"
title: "Rewrite viewer-architecture.md for the shipped navigation model"
status: "completed"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
  - "pr-26"
source: "0.8.0 PR B7 sidecar review, 2026-10-02: docs/architecture/viewer-architecture.md (last edited 2026-03-08) has no generator and describes ViewerDescriptor, NAV_ENTRIES and sidebar.ts, none of which exist on main"
startedAt: "2026-10-02T18:07:38.386Z"
completedAt: "2026-10-02T18:29:27.606Z"
endedAt: "2026-10-02T18:29:27.606Z"
acceptanceCriteria:
  - "The document describes view-meta.ts, stages.ts (including SETTINGS_ENTRIES), view-routing.ts aliases, the top navigation and breadcrumbs, the Live views and the settings and commands sheets as they exist on main."
  - "Every file path, export and test the document names exists on main."
  - "ViewerDescriptor, NAV_ENTRIES and components/sidebar.ts appear only in the History section."
description: "docs/architecture/viewer-architecture.md still describes the March 2026 decision record: per-package ViewerDescriptor objects, NAV_ENTRIES and a sidebar built in components/sidebar.ts. None of those exist on main. The shipped dashboard is driven by one navigation model: packages/web/src/viewer/views/view-meta.ts (VIEW_META, one entry per ViewId with label, glyph and product), packages/web/src/viewer/views/stages.ts (STAGES for the Analyze, Plan and Work stages with their sections, tabs, feature gates and requiresServer flags, plus SETTINGS_ENTRIES), packages/web/src/shared/view-routing.ts (VIEW_ALIASES and resolveViewAlias, including the scoped-viewer case where an alias target is not a valid view), the top navigation, breadcrumb and stage-link components in packages/web/src/viewer/components/, the Home view, the Live views (live, live-task, live-analyze), and the settings and commands sheets that open over the current page.\n\nRewrite the document to describe that model as it is on main: where a view is declared, how a stage composes its sections, how routing and redirect aliases resolve, how settings and the commands sheet open, how a package-scoped standalone viewer differs from the unified dashboard, and which tests hold the contract (packages/web/tests/e2e-ui/navigation.spec.ts is a required test; also the navigation-model unit tests). Keep the original decision record as a short, clearly labelled \"History\" section at the end rather than deleting it. Every file path, export and test named in the document must exist on main; read the code rather than inferring from names.\n\nImplementation notes: documentation only — no source changes, so no changeset. Do not reproduce measured zone metrics. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; run pnpm preflight before opening the PR."
lastModified: "2026-10-02T18:29:28.093Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
