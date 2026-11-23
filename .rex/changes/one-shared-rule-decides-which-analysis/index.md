---
id: "31f5dfae-1f11-4dfd-b2df-a5621315c845"
type: "change"
title: "One shared rule decides which analysis items need work"
slug: "one-shared-rule-decides-which-analysis"
summary: "The Analysis page and the Graview product map each decide on their own which parts of the codebase need work, so they can disagree. Moving that decision into one shared place makes both show the same list."
intent: "Two sibling changes built the 'needs work' set twice. Change 16b0e619 (Analysis top row) added `buildRecommendations()` in `packages/web/src/viewer/views/action-items.ts`, merging next steps, readiness gaps, problems, suggestions, architecture findings and files to move. Change b668a77b (Graview '!' markers) marks a zone as needing work when one of the top five `deriveNextSteps` results names it (`RECOMMENDED_STEPS` in `packages/graview/src/sources/code.ts`). It also copies web's `zoneNeedsAttention` threshold (cohesion < 0.4 or coupling > 0.5) because graview cannot import web. Move the rule (which items need work, and which zones are only highlighted) into sourcevision's public API, and have both web (through its domain gateway) and graview (through its sourcevision gateway) consume it."
acceptanceCriteria:
  - "Sourcevision exports one function that returns the items needing work and the zones needing attention from its analysis output"
  - "The web Analysis page's recommended-fixes list and attention highlights come from that function through the web domain gateway"
  - "The graview projection's needsWork and highlighted flags come from that function through graview's sourcevision gateway"
  - "No copy of the attention threshold or the recommended-steps limit remains in web or graview"
  - "A test asserts the Analysis page and the graview projection mark the same zones for one fixture"
touches:
  - "acebe9ce-090f-480e-a9fd-e578f2b34a2b"
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
discoveredFrom: {"item":"16b0e619-7330-4247-b526-a8148101da4d"}
tags:
  - "sourcevision"
  - "web"
  - "graview"
  - "refactor"
source: "ndx-capture"
blockedBy:
  - "16b0e619-7330-4247-b526-a8148101da4d"
  - "b668a77b-b497-4193-af52-f14718cbc43f"
---
