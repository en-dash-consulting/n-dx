---
id: "6ce9b707-d96d-4133-a871-bd663e6d966c"
type: "change"
title: "Define structure health thresholds and add to rex config schema"
slug: "define-structure-health-thresholds-and"
intent: "Add configurable thresholds to .rex/config.json: maxTopLevelEpics (default: 15), maxTreeDepth (default: 5), maxChildrenPerContainer (default: 20), minChildrenPerContainer (default: 2). Add schema validation for these fields. Expose them through ndx config."
acceptanceCriteria:
  - "Thresholds defined in RexConfig with sensible defaults"
  - "Schema validation accepts the new fields"
  - "ndx config can read/write the thresholds"
touches:
  - "f0294876-d42d-497e-a3c6-c5abf7a374ed"
priority: "high"
tags:
  - "rex"
---
