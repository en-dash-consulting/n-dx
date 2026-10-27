---
id: "fbf65d5c-ea15-44bb-84c6-97927e87576a"
type: "change"
title: "Identify and remove exported symbols with zero external consumers"
slug: "identify-and-remove-exported-symbols"
intent: "Extend the static-analysis pass to find exported functions, types, and constants that are never imported outside their own module (excluding public.ts API surfaces and gateway re-exports). Delete each confirmed dead export and its implementation if it has no internal callers either. Pay special attention to barrel files that re-export symbols only to satisfy an old interface; remove those re-exports and trace whether the underlying implementation can also be deleted."
acceptanceCriteria:
  - "No exported symbol in any production file has zero confirmed external consumers, except those explicitly listed in public.ts or gateway modules"
  - "Implementation code deleted alongside its export has zero remaining call sites confirmed by grep"
  - "pnpm build and pnpm test pass after removals"
  - "Net line reduction across all packages is at least 80 lines"
touches:
  - "56f47d3d-d39d-4938-9923-b3735656ba7b"
priority: "high"
tags:
  - "dead-code"
  - "refactor"
  - "cleanup"
source: "smart-add"
---
