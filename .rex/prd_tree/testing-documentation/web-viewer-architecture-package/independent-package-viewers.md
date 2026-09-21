---
id: "ed5f43ba-3b20-49d9-8499-6171625c18b9"
level: "task"
title: "Independent package viewers"
status: "completed"
priority: "medium"
tags:
  - "architecture"
  - "build"
  - "dx"
  - "packages"
  - "viewer"
startedAt: "2026-02-10T04:35:42.275Z"
completedAt: "2026-02-10T04:35:42.275Z"
acceptanceCriteria: []
description: "Design and implement lightweight standalone viewers for independently-installed packages. When a user installs only `sourcevision`, `sourcevision serve` should still work with a minimal viewer showing just analysis data. Same for `rex serve` (PRD view) and potentially `hench serve` (run history). The unified n-dx dashboard composes all of these. Each package exports its viewer components/routes, and the unified dashboard assembles them.\n\n---\n\nEstablish a proper development workflow for the viewer: HMR/live reload during development, a clean build pipeline for viewer assets (HTML, CSS, JS), and a dev command (`ndx dev` or similar). Currently the viewer is a single HTML file with inline styles — decide if this stays simple or moves to a proper frontend build tool (Vite, etc.)."
---
