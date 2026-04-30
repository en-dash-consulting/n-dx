---
id: "6ce9b707-d96d-4133-a871-bd663e6d966c"
level: "task"
title: "Define structure health thresholds and add to rex config schema"
status: "completed"
priority: "high"
tags:
  - "rex"
startedAt: "2026-03-24T19:53:16.787Z"
completedAt: "2026-03-24T19:54:47.619Z"
acceptanceCriteria:
  - "Thresholds defined in RexConfig with sensible defaults"
  - "Schema validation accepts the new fields"
  - "ndx config can read/write the thresholds"
description: "Add configurable thresholds to .rex/config.json: maxTopLevelEpics (default: 15), maxTreeDepth (default: 5), maxChildrenPerContainer (default: 20), minChildrenPerContainer (default: 2). Add schema validation for these fields. Expose them through ndx config."
---
