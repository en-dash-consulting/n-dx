---
id: "d61ecd59-b598-4cf6-8743-9d24e0f8435b"
type: "task"
title: "An empty 'How planning works' band shows while loading or after an error"
slug: "an-empty-how-planning-works-band-shows"
summary: "While the planning guide loads, or if it fails, an empty bordered strip with a heading stays on the Plan page. This hides it until there is something to show."
description: "Verdict: should-fix (severity low, cheap), from the adversarial review of feat/plan-process-visual.\n\nTrigger: /api/rex/changes/summary pending or failing (e.g. 500). PlanProcess returns null, but the band wrapper still renders a 2px bordered sliver plus a --space-3 gap; on error it stays above the strip's alert, and screen readers announce an empty 'How planning works' region.\n\nEvidence: plan-process.ts:133-138 with stage-tiles.ts:324-326 and stage-tiles.css:1179 (.stage-band has border and background, no padding).\n\nFix: `.stage-band:empty { display: none; }` (Preact leaves the section empty), or a matching Loading placeholder. One line, no risk."
acceptanceCriteria:
  - "While the summary is loading or after it fails, no bordered band or empty labelled region is rendered for the process band"
  - "A test mounts the band with a pending fetch and with a failed fetch"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
