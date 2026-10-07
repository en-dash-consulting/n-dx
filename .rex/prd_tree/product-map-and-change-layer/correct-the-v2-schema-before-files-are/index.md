---
id: "8b38b308-be40-4cb1-9f92-ee0233f0b8ac"
level: "feature"
title: "Correct the v2 schema before files are written"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-27"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
blockedBy:
  - "dc3b80c1-4d3c-486f-ba03-0b6bbe9fd50d"
source: "roadmap"
acceptanceCriteria: []
description: "Two schema corrections that must land after the v2 types (PR 7) and before the state writer and the v2 tree writer (PRs 8 and 9) put anything on disk, because the schema freezes at 1.0.0. Small, single-lane, strongest tier with --review.\n\nRoadmap PR 27 · wave 1 · lane rex-store."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-06T16:54:39.372Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Declare the level-of-effort fields and reserve effort in the v2 schema](./declare-the-level-of-effort-fields-and.md) | in_progress |
| [Give saved run settings a home in the v2 schema](./give-saved-run-settings-a-home-in-the.md) | pending |
| [Record which task or run found a change (discoveredFrom)](./record-which-task-or-run-found-a.md) | pending |
| [Rename the map layer to product in the v2 types](./rename-the-map-layer-to-product-in-the.md) | completed |
