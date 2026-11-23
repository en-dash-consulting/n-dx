---
id: "50b052cf-d10f-46be-9c37-c30f415f0693"
type: "task"
title: "Cross-zone imports filter hides the next steps about cross-zone imports"
slug: "cross-zone-imports-filter-hides-the"
summary: "Clicking 'Cross-zone imports' on the Analysis page hides the very fixes that are about cross-zone imports. This tags those fixes correctly so the filter finds them."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/analysis-two-tile-top-row (0e3fca4c4).\n\nThe boundaries tag is only added by buildInfraActions; steps and problems only get cohesion/coupling tags (metricConcerns, action-items.ts:186-219). On this repo's real zones.json, the steps 'Rex CLI imports Rex Migrations on 16 edge(s)… looks like a layering' and 'Web Server imports Web Hub…' have concerns: [], although their text matches CONCERN_TEXT.boundaries. Pressing Cross-zone imports hides the two high-priority fixes about it. Worse with the new dedupe: when a top-5 step covers a relationship or move-file finding, the boundary-tagged infra item is removed and the covering step has no boundaries tag, so the filter loses it entirely (the branch's own 'lists a finding a next step covers only as that step' test shows the removal).\n\nEvidence: packages/web/src/viewer/views/action-items.ts:281-289 (buildRecommendations).\n\nFix (recommended a + b for problems): (a) in buildRecommendations give each step the union of its covered findings' concerns via relatedFindings (~10 lines + test); (b) add a text-regex boundaries tag to health items."
acceptanceCriteria:
  - "A next step that covers a finding carries that finding's concern tags"
  - "Next steps and problems whose text describes a layering or cross-zone import carry the boundaries tag"
  - "Pressing Cross-zone imports shows next steps that cover a relationship or move-file finding"
  - "Tests cover both the covered-finding and the text-tag cases"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
