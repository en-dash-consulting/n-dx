---
id: "a7c0061e-eb80-473b-84b2-861194fbcc47"
level: "feature"
title: "Route the remaining .n-dx config readers through the resolver"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-29"
  - "lane-models-analysis"
  - "sourcevision"
  - "core"
  - "web"
  - "hench"
blockedBy:
  - "c81707dc-7c9a-47ba-9043-9a588a87ac76"
source: "roadmap"
acceptanceCriteria: []
description: "After the layout-resolver sweep (#529), 29 hard-coded .n-dx* paths remain in 22 files (tests/layout-literal-inventory.md). On a project using the .ndx/ layout, config lives at .ndx/config.json, so these readers silently read nothing: sourcevision ignored risk justifications, zone types, language and inventory overrides, archetype overrides, workspace members and the iso-map architecture, and the analysis still succeeded. ndx init has created .ndx/ projects since 0.8.0, so this is live today, and 1.0.0 makes .ndx/ the only layout (decision A3a): every literal must be routed before the legacy refusal and this repository's migration. Mechanical; the inventory is the done-check. Run with --review.\n\nRoadmap PR 29 · wave 1 · lane models-analysis."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-06T23:38:07.311Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Replace every .n-dx* literal with the resolved config path](./replace-every-n-dx-literal-with-the.md) | pending |
| [Turn the .n-dx* ratchet into a wall](./turn-the-n-dx-ratchet-into-a-wall.md) | pending |
