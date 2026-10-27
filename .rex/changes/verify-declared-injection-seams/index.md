---
id: "d9e4fb4a-1cbf-4933-82aa-10f58de1f3db"
type: "change"
title: "Verify declared injection seams against the code"
slug: "verify-declared-injection-seams"
intent: "A seam declared under `sourcevision.isoMap.injectionSeams` is drawn on the map on trust — nothing checks the named callbacks still exist, or that the injection site still injects them. A refactor can leave the declaration behind, and the map will keep asserting a relationship that no longer exists, which is worse than showing nothing.\n\nThe call graph is the obvious cross-check: a declared seam whose callbacks appear in `callgraph.json` between the two zones is corroborated; one with no supporting calls is stale or wrong."
acceptanceCriteria:
  - "A declared seam is checked against the call graph when one is available"
  - "A seam with no supporting evidence is marked as unverified in its panel rather than drawn identically to a corroborated one"
  - "A seam naming callbacks that no longer exist in the target is reported to the reader"
touches:
  - "79ff43cf-43e9-4615-9227-31eb90b2d10f"
priority: "low"
tags:
  - "sourcevision"
  - "isometric"
  - "correctness"
---
