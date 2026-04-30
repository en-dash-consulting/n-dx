---
id: "ed4461f5-7667-4c72-bbee-f39457b951fe"
level: "feature"
title: "Web Viewer Architecture: Package Extraction and Independent Viewers"
status: "completed"
priority: "high"
tags:
  - "viewer"
  - "architecture"
  - "dx"
startedAt: "2026-02-10T04:35:42.328Z"
completedAt: "2026-02-10T04:35:42.328Z"
acceptanceCriteria: []
description: "The web viewer currently lives entirely in `packages/sourcevision/` but serves rex, hench, and sourcevision data — it's an n-dx dashboard, not a sourcevision viewer. This epic addresses: (1) where the viewer code should live (new `packages/web` or monorepo root), (2) whether each package (sourcevision, rex, hench) should have its own lightweight standalone viewer for independent installs, (3) how the unified n-dx dashboard composes those views, (4) proper dev server setup (HMR, build pipeline, static asset handling). Goal: clean package boundaries where the viewer code lives at the right level, packages remain independently installable and viewable, and there's a proper dev workflow."
---

# Web Viewer Architecture: Package Extraction and Independent Viewers

🟠 [completed]

## Summary

The web viewer currently lives entirely in `packages/sourcevision/` but serves rex, hench, and sourcevision data — it's an n-dx dashboard, not a sourcevision viewer. This epic addresses: (1) where the viewer code should live (new `packages/web` or monorepo root), (2) whether each package (sourcevision, rex, hench) should have its own lightweight standalone viewer for independent installs, (3) how the unified n-dx dashboard composes those views, (4) proper dev server setup (HMR, build pipeline, static asset handling). Goal: clean package boundaries where the viewer code lives at the right level, packages remain independently installable and viewable, and there's a proper dev workflow.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Extract viewer from sourcevision into shared web package | task | completed | 2026-02-10 |
| Independent package viewers | task | completed | 2026-02-10 |

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** viewer, architecture, dx
- **Level:** feature
- **Started:** 2026-02-10T04:35:42.328Z
- **Completed:** 2026-02-10T04:35:42.328Z
- **Duration:** < 1m
