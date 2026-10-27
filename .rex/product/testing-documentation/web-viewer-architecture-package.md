---
id: "ed4461f5-7667-4c72-bbee-f39457b951fe"
type: "capability"
title: "Web Viewer Architecture: Package Extraction and Independent Viewers"
slug: "web-viewer-architecture-package"
statement: "The n-dx web viewer lives in its own web package and serves a unified dashboard of rex, hench and sourcevision data, while sourcevision and rex can each still serve a standalone viewer of their own data when installed alone."
criteria: [{"id":"c1","text":"The web server and viewer assets shall live in the packages/web package at the orchestration layer rather than inside packages/sourcevision."},{"id":"c2","text":"When only sourcevision is installed, `sourcevision serve` shall serve a minimal viewer that shows the analysis data."},{"id":"c3","text":"When only rex is installed, `rex serve` shall serve a standalone viewer that shows the PRD."},{"id":"c4","text":"The unified n-dx dashboard shall assemble the viewer components and routes that each package exports."},{"id":"c5","text":"While the viewer runs in development, the dev workflow shall reload the viewer live when its source changes."}]
tags:
  - "viewer"
  - "architecture"
  - "dx"
priority: "high"
---

The web viewer currently lives entirely in `packages/sourcevision/` but serves rex, hench, and sourcevision data — it's an n-dx dashboard, not a sourcevision viewer. This epic addresses: (1) where the viewer code should live (new `packages/web` or monorepo root), (2) whether each package (sourcevision, rex, hench) should have its own lightweight standalone viewer for independent installs, (3) how the unified n-dx dashboard composes those views, (4) proper dev server setup (HMR, build pipeline, static asset handling). Goal: clean package boundaries where the viewer code lives at the right level, packages remain independently installable and viewable, and there's a proper dev workflow.
