---
id: "4a268b86-21d1-4dd0-983f-39a629f4d716"
type: "task"
title: "Graview highlights sub-zones the Analysis page never flags"
slug: "graview-highlights-sub-zones-the"
summary: "The product map marks many sub-areas of the code as flagged on the Analysis page when that page only flags top-level areas. This marks only what the Analysis page actually flags."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/graview-needs-work-markers (75ce44c9b).\n\nThe web counts zones needing attention over top-level zones only (zones.zones.filter(zoneNeedsAttention): web/src/viewer/views/overview.ts:371, :786; tile-summaries.ts:69). Graview applies the rule inside the recursive walkZones to every sub-zone (packages/graview/src/sources/code.ts:108: highlighted: !needsWork && needsAttention(zone)). On this repo's emit 31 of 37 highlighted zones are sub-zones, and the face's zone page (graview-face/src/ui/screens/zone.tsx:40-44), the declaration's field description and the changeset tell them they are 'flagged for attention on the Analysis page', which is false. Distinct from follow-up 31f5dfae (rule divergence/threshold duplication).\n\nFix (recommended, one line + test): highlighted: !needsWork && !parent && needsAttention(zone). Alternative: keep sub-zone highlighting and reword every 'on the Analysis page' claim."
acceptanceCriteria:
  - "Only top-level zones carry highlighted: true in the emitted snapshot"
  - "A test with a sub-zone at cohesion 0.1 asserts it is not highlighted while its top-level parent at cohesion 0.1 is"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
