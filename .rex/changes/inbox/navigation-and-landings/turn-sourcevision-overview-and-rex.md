---
id: "c2a7f1e7-0935-4573-a5d4-86749cccfa51"
type: "task"
title: "Turn SourceVision Overview and Rex Dashboard into package landing pages, add a Hench landing, and move Rex execution panels to the Flight Deck"
slug: "turn-sourcevision-overview-and-rex"
description: "Superseded by #425 (2e58d8e1), 2026-09-29. The Analysis, Plan and Work stage pages are the SourceVision, Rex and Hench landings, generated from views/stages.ts. The Rex dashboard, with its execution panel, is the Work stage's lead section and is not on Plan. Flight Deck › Now is 0.9.0 (C1). Old Overview and Rex Dashboard ids are covered by e8fb5412."
acceptanceCriteria:
  - "SourceVision, Rex and Hench each have a landing page with cards generated from the navigation model."
  - "Rex execution panels render on the Flight Deck and no longer on the Rex landing."
  - "Old view ids for Overview and Rex Dashboard still resolve (via the redirects from the contract task)."
priority: "medium"
tags:
  - "0.8.0"
  - "navigation-landings"
  - "pr-23"
source: "caos work management: WM-2116 (Turn SourceVision Overview and Rex Dashboard into package landing pages, add a Hench landing, and move Rex execution panels to the Flight Deck); 0.8.0 planning, PR 23 · Navigation and landings"
blockedBy:
  - "22d013f6-b2f5-46e3-a335-91ae32d2e934"
---
