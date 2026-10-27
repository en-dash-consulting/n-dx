---
id: "ed5f43ba-3b20-49d9-8499-6171625c18b9"
type: "change"
title: "Independent package viewers"
slug: "independent-package-viewers"
intent: "Design and implement lightweight standalone viewers for independently-installed packages. When a user installs only `sourcevision`, `sourcevision serve` should still work with a minimal viewer showing just analysis data. Same for `rex serve` (PRD view) and potentially `hench serve` (run history). The unified n-dx dashboard composes all of these. Each package exports its viewer components/routes, and the unified dashboard assembles them.\n\n---\n\nEstablish a proper development workflow for the viewer: HMR/live reload during development, a clean build pipeline for viewer assets (HTML, CSS, JS), and a dev command (`ndx dev` or similar). Currently the viewer is a single HTML file with inline styles — decide if this stays simple or moves to a proper frontend build tool (Vite, etc.)."
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "medium"
tags:
  - "architecture"
  - "build"
  - "dx"
  - "packages"
  - "viewer"
---
