---
id: "d9e4fb4a-1cbf-4933-82aa-10f58de1f3db"
level: "task"
title: "Verify declared injection seams against the code"
status: "completed"
priority: "low"
tags:
  - "sourcevision"
  - "isometric"
  - "correctness"
startedAt: "2026-09-09T19:37:38.926Z"
completedAt: "2026-09-09T19:53:11.566Z"
endedAt: "2026-09-09T19:53:11.566Z"
resolutionType: "code-change"
resolutionDetail: "Declared seams are checked against the call graph: zone-scoped callback evidence, unverified seams drawn with a desaturated sparser stroke and labelled in their panel, unsupported callbacks named in the footer. No call graph leaves the verdict undefined rather than negative. Found and fixed the repo's own stale declaration (register-scheduler.ts moved under task-usage/) and a class-loss bug in the redraw path. 14 new tests; full suite 6/6. Commit f34ee934."
acceptanceCriteria:
  - "A declared seam is checked against the call graph when one is available"
  - "A seam with no supporting evidence is marked as unverified in its panel rather than drawn identically to a corroborated one"
  - "A seam naming callbacks that no longer exist in the target is reported to the reader"
description: "A seam declared under `sourcevision.isoMap.injectionSeams` is drawn on the map on trust — nothing checks the named callbacks still exist, or that the injection site still injects them. A refactor can leave the declaration behind, and the map will keep asserting a relationship that no longer exists, which is worse than showing nothing.\n\nThe call graph is the obvious cross-check: a declared seam whose callbacks appear in `callgraph.json` between the two zones is corroborated; one with no supporting calls is stale or wrong."
lastModified: "2026-09-09T19:53:11.590Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
