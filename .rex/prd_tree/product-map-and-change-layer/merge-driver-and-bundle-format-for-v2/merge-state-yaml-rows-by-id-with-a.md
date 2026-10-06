---
id: "ae195bab-197e-4384-a371-f3f75dd120b9"
level: "task"
title: "Merge state.yaml rows by id with a custom merge driver"
status: "pending"
priority: "medium"
tags:
  - "pr-15"
  - "lane-rex-store"
  - "rex"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "Concurrent child adds merge cleanly (test)"
  - "Conflicting metAt is recomputed (test)"
description: "Merge rows by id; where both sides changed metAt or status, recompute from intent rather than pick a side. Register the driver and line-ending pins through core/gitattributes-pins.js."
lastModified: "2026-10-06T04:17:47.912Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
