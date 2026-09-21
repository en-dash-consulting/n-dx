---
id: "95b5c864-f4de-4c66-bfba-3335c8f92b70"
level: "task"
title: "Route true title-conflict duplicates through existing reshape merge rules"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "reshape"
source: "smart-add"
startedAt: "2026-05-14T18:44:03.701Z"
completedAt: "2026-05-14T18:53:44.228Z"
endedAt: "2026-05-14T18:53:44.228Z"
resolutionType: "code-change"
resolutionDetail: "Added configurable titleCollisionSimilarityThreshold to RexConfig/RexConfigSchema. detectNonDuplicateTitleCollisions accepts threshold param; runScopedConsolidationPass reads from config. Integration test covers merge (high-similarity) and rename (low-similarity) routing from cmdAdd."
acceptanceCriteria:
  - "Title collision triggers a duplicate-likelihood check comparing descriptions and acceptance criteria"
  - "High-similarity items are merged via the existing reshape merge path with pre-merge commit and archive entry"
  - "Low-similarity items are routed to the rename resolution path"
  - "Classifier threshold is configurable via .rex/config.json with a documented default"
  - "Integration test covers both routing outcomes (merge vs rename) from a single rex add invocation"
description: "When a title collision occurs between items whose descriptions indicate they are genuine duplicates, route the resolution through the existing same-parent duplicate merge pass (feature 6518b3be) rather than creating a suffixed copy. The decision between rename (above task) and merge happens via a duplicate-likelihood classifier that compares descriptions and acceptance criteria."
---
