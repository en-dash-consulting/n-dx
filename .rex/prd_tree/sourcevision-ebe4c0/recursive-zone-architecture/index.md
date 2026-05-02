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

# Recursive zone architecture

 [completed]

## Summary

Make subdivision use the same full pipeline as root analysis. Same algorithm at every zoom level — fractal zones. Zone detection currently lumps components, routes, utils, and configs into mega-zones because subdivideZone() runs a stripped-down Louvain without resolution escalation, proximity edges, or splitLargeCommunities.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Full-pipeline zone subdivision | task | completed | 2026-03-02 |
| Multi-repo workspace aggregation | task | completed | 2026-03-03 |
| Web viewer zone drill-down | task | completed | 2026-03-02 |

## Info

- **Status:** completed
- **Tags:** sourcevision, zones, architecture
- **Level:** feature
- **Started:** 2026-03-02T16:33:26.638Z
- **Completed:** 2026-03-02T16:33:26.638Z
- **Duration:** < 1m
