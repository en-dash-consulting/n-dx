---
id: "epic-recursive-zone-arch"
level: "feature"
title: "Recursive zone architecture"
status: "completed"
tags:
  - "sourcevision"
  - "zones"
  - "architecture"
startedAt: "2026-03-02T16:33:26.638Z"
completedAt: "2026-03-02T16:33:26.638Z"
acceptanceCriteria: []
description: "Make subdivision use the same full pipeline as root analysis. Same algorithm at every zoom level — fractal zones. Zone detection currently lumps components, routes, utils, and configs into mega-zones because subdivideZone() runs a stripped-down Louvain without resolution escalation, proximity edges, or splitLargeCommunities."
---

## Children

| Title | Status |
|-------|--------|
| [Full-pipeline zone subdivision](./full-pipeline-zone-subdivision.md) | completed |
| [Multi-repo workspace aggregation](./multi-repo-workspace-aggregation.md) | completed |
| [Web viewer zone drill-down](./web-viewer-zone-drill-down.md) | completed |
