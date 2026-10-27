---
id: "2737672a-06b8-41b5-9fe1-1678905a1b8a"
type: "change"
title: "Dashboard: Architecture, Problems and Suggestions unlock after a cascade analysis"
slug: "dashboard-architecture-problems-and"
intent: "The sidebar and the three views gate on `zones.enrichmentPass` ≥ 2 / 3 / 4, the pass numbers of the generative pipeline, where each `--full` pass adds one kind of finding. A cascade run is one judged pass (enrichmentPass 1) that already yields every kind: anti-patterns, suggestions, relationships, observations. It never runs passes 2–4, so on a cascade-analysed repo these views stay locked however often it is re-scanned. On n-site2: enrichmentPass 1, mode cascade, with 2 anti-patterns, 28 suggestions, 1 relationship and 71 observations present but unreachable.\n\nFix: sourcevision records `zones.enrichmentMode` (`cascade` | `generative`), carried through reused runs. The viewer gates on `effectiveEnrichmentPass(zones, manifest)`, which treats a cascade analysis with at least one pass as complete (pass 4). It falls back to `manifest.lastAnalysis.mode` for zones.json files written before the field existed."
acceptanceCriteria:
  - "zones.json from a cascade analyze carries enrichmentMode: cascade, including after sv narrate rewrites it"
  - "Unit test: effectiveEnrichmentPass is the raw pass for generative, 4 for cascade, 4 via manifest.lastAnalysis.mode for older zones.json, 0 with no enrichment"
  - "Sidebar, Architecture, Problems and Suggestions all gate on effectiveEnrichmentPass"
  - "pnpm --filter @n-dx/web test and pnpm --filter @n-dx/sourcevision test pass"
touches:
  - "6a8f9616-59f0-458f-8e56-45abbb00a3da"
priority: "high"
tags:
  - "sourcevision"
  - "web"
source: "ndx-capture"
---
