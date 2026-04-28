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
description: "Design and implement lightweight standalone viewers for independently-installed packages. When a user installs only `sourcevision`, `sourcevision serve` should still work with a minimal viewer showing just analysis data. Same for `rex serve` (PRD view) and potentially `hench serve` (run history). The unified n-dx dashboard composes all of these. Each package exports its viewer components/routes, and the unified dashboard assembles them.\n\n---\n\nEstablish a proper development workflow for the viewer: HMR/live reload during development, a clean build pipeline for viewer assets (HTML, CSS, JS), and a dev command (`ndx dev` or similar). Currently the viewer is a single HTML file with inline styles — decide if this stays simple or moves to a proper frontend build tool (Vite, etc.)."
---

## Subtask: Design composable viewer architecture for independent packages

**ID:** `87c852ac-1348-4fe2-a109-a72312289b8e`
**Status:** completed
**Priority:** medium

Design how each package (sourcevision, rex, hench) can expose its own minimal viewer. Options: (A) each package exports route handlers + a small HTML template that packages/web can compose, (B) each package ships a standalone single-file viewer and packages/web assembles them via iframes or tabs, (C) packages only export data APIs and all UI lives in packages/web. Decide on approach and document the contract.

**Acceptance Criteria**

- Architecture decision documented
- Contract defined for how packages expose viewer capabilities
- Approach validated against the independently-installable requirement

---

## Subtask: Implement standalone `sourcevision serve` viewer

**ID:** `fca6ae59-b5af-4b83-adb6-d0f863e18951`
**Status:** completed
**Priority:** medium

When sourcevision is installed independently (without n-dx), `sourcevision serve` should show a minimal viewer with just analysis data — zones, imports, inventory, findings. No rex or hench sections. This could be a lightweight server bundled with sourcevision, or the composable architecture falling back to sourcevision-only mode.

**Acceptance Criteria**

- `sourcevision serve .` works without rex or hench installed
- Shows analysis data: zones, imports, inventory, findings
- No broken references to rex/hench when those packages are absent

---

## Subtask: Dynamic favicon based on active package section

**ID:** `ccfabe5d-8d15-410a-8aa0-fde270b70a6d`
**Status:** completed
**Priority:** low

The browser favicon should default to the n-dx logo and dynamically change when the user navigates to a package-specific section (sourcevision, rex, hench). Each package provides its own icon/branding. On the unified dashboard, switching sections updates the favicon to reflect the active context. This reinforces the independent-package identity within the composed dashboard.

**Acceptance Criteria**

- Default favicon is n-dx logo
- Favicon changes to sourcevision icon when viewing sourcevision section
- Favicon changes to rex icon when viewing rex section
- Favicon changes to hench icon when viewing hench section
- Favicon reverts to n-dx when on a non-package-specific page (e.g. overview)

---

## Subtask: Set up viewer dev server with HMR

**ID:** `f8ac5cf0-0faa-4153-9a92-2b47953b6755`
**Status:** completed
**Priority:** medium

Establish a dev workflow for working on the viewer. Currently the viewer is a single HTML file with inline everything — no build step, no hot reload during development. Evaluate: (A) keep it simple with the existing fs.watch + WebSocket live-reload, (B) add Vite or similar for proper HMR and module support. A `ndx dev` or `ndx start --dev` command should start the server with whatever dev tooling is chosen.

**Acceptance Criteria**

- Dev command exists for viewer development
- Changes to viewer HTML/CSS/JS are reflected without manual restart
- Build pipeline produces optimized assets for production

---
