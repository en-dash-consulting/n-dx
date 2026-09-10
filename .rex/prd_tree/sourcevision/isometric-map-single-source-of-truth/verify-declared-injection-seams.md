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
startedAt: "2026-09-04T21:24:30.055Z"
completedAt: "2026-09-04T21:24:38.050Z"
endedAt: "2026-09-04T21:24:38.050Z"
resolutionType: "code-change"
resolutionDetail: "Declared seams are now checked against callgraph.json. New indexCalleesByFile + verifySeamCallbacks in iso-sources.ts (keeps unresolved-callee edges, which aggregateCallEdges drops — an injected callback is a parameter, so those are the only evidence a seam has); evidence is searched across the receiving zone because a receiving module routinely delegates the callbacks on. The model carries IsoSeamVerification; the page draws an unverified seam thinner/fainter with a sparser dash, says so in the aria-label and panel, names the matched file and expression per corroborated callback, and lists uncalled callbacks in the footer. No call graph, or no callbacks declared, reports as unchecked rather than unverified. 19 new tests in iso-seam-verification.test.ts (unit + through the model + jsdom page); skill bundle regenerated; docs updated. Also fixed the stale .n-dx.json declaration, which named packages/web/src/server/register-scheduler.ts — a path that has not existed since the file moved into task-usage/, and exactly the failure mode this task describes."
acceptanceCriteria:
  - "A declared seam is checked against the call graph when one is available"
  - "A seam with no supporting evidence is marked as unverified in its panel rather than drawn identically to a corroborated one"
  - "A seam naming callbacks that no longer exist in the target is reported to the reader"
description: "A seam declared under `sourcevision.isoMap.injectionSeams` is drawn on the map on trust — nothing checks the named callbacks still exist, or that the injection site still injects them. A refactor can leave the declaration behind, and the map will keep asserting a relationship that no longer exists, which is worse than showing nothing.\n\nThe call graph is the obvious cross-check: a declared seam whose callbacks appear in `callgraph.json` between the two zones is corroborated; one with no supporting calls is stale or wrong."
lastModified: "2026-09-04T21:24:38.080Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
