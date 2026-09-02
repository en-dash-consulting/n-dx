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

## Children

| Title | Status |
|-------|--------|
| [Extract viewer from sourcevision into shared web package](./extract-viewer-from-e49a18.md) | completed |
| [Independent package viewers](./independent-package-viewers.md) | completed |
