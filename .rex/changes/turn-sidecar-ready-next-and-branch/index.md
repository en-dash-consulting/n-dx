---
id: "f55f5a4c-036a-40b5-b0ee-5ea4b1b586e1"
type: "change"
title: "Turn Sidecar, Ready next and branch health on by default"
slug: "turn-sidecar-ready-next-and-branch"
intent: "Step 1 of unflagging the Sidecar, decided in the 2026-11-12 feature-flag audit. The Sidecar stack merged to main on 2026-11-06 behind web.sidecar (default off since 2026-10-26). Two of its lenses check a second toggle before they open: Guide needs hench.readyNext and Diagnose-branch needs git.branchHealth (packages/web/src/server/sidecar/lens-packets.ts), so the three move together.\n\nChange defaultValue to true for web.sidecar, hench.readyNext and git.branchHealth in FEATURE_REGISTRY (packages/web/src/server/routes-features.ts), and the matching `useFeatureToggle(key, false)` fallbacks in the viewer (main.ts, views/project.ts, views/tooling-panel.ts, components/tracker-chip.ts, views/live-tracker.ts, views/live-ready-next.ts, views/workspace-branch-health.ts). Keep the toggles for this release so a project can still set one to false.\n\nOut of scope: web.sidecarGithubReads is a per-project permission for running gh, not a feature flag. It stays off by default."
acceptanceCriteria:
  - "With no `features` block in .n-dx.json, the Sidecar drawer, Live's Ready next and the Workspaces health strip all show, and every Sidecar lens opens"
  - "A project that stores false for any of the three keeps that feature off: its entry points are hidden and its routes answer 403"
  - "A static export still shows no Sidecar"
  - "web.sidecarGithubReads still defaults off, and branch health runs gh only when it is on"
  - "docs/guide/configuration.md and docs/packages/web.md describe the three as on by default"
  - "A patch changeset for @n-dx/web"
touches:
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "high"
tags:
  - "feature-flags"
  - "web"
  - "sidecar"
source: "ndx-capture"
---
