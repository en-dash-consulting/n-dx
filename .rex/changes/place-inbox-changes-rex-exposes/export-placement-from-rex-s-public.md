---
id: "235d4530-4f87-4605-a451-d0f14432f45d"
type: "task"
title: "Export placement from rex's public entry point, with tie and strength on suggestions"
slug: "export-placement-from-rex-s-public"
description: "Export `suggestPlacement`, `recordPlacement`, `ChangePlacementError`, `ChangePlacementErrorKind`, `PlacementSuggestion`, `RecordPlacementInput`, `RecordPlacementResult` and `PlacementCandidate` from `packages/rex/src/public.ts` (beside the existing `awaitsPlacement` export).\n\nAdd to `PlacementSuggestion` (`core/change-place.ts`): `tied: boolean`, true when the top two candidates share a score (the ranker breaks ties by id, which put the wrong capability first on this repo's \"Changes view: time-ordered default\" change). Add `strength: \"strong\" | \"possible\" | \"weak\"` to each candidate: strong at 10 or more, possible 6–9, weak 5 or less. Define the thresholds once, in `core/placement.ts` beside the weights, and export the helper so the web package uses the same values rather than its own copy.\n\nShow both in `rex change place <change>` text output and its `--format=json`, and in MCP `place_change` without a target."
acceptanceCriteria:
  - "The listed symbols import from @n-dx/rex"
  - "A suggestion whose top two candidates share a score reports tied: true; otherwise false"
  - "Each candidate carries strength from one exported helper: score 10+ strong, 6-9 possible, 5 or less weak"
  - "rex change place (text and json) and MCP place_change without target show tied and strength"
  - "Unit tests cover the tie, each strength band and the boundaries 5/6 and 9/10"
priority: "high"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
