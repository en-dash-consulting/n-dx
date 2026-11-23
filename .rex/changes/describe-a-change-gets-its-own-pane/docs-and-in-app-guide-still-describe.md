---
id: "77d5c597-e8bf-4920-863e-1a6ebfc6aa0d"
type: "task"
title: "Docs and in-app guide still describe Plan's capture bar and one lead section"
slug: "docs-and-in-app-guide-still-describe"
summary: "Several help texts still describe the old capture bar at the top of Plan. This updates them to the new capture panel."
description: "Verdict: should-fix (severity low, cheap), from the adversarial review of feat/capture-pane-modal.\n\nStale: docs/architecture/viewer-architecture.md:32 says plain is 'One per stage, first' (relaxed at stages.ts:56); packages/web/src/viewer/components/guide.ts:36 describes Plan as 'the capture bar, then a lifecycle strip'; docs/packages/web.md:185 ('Capture bar, beside Preview'); smart-add-input.ts:12 header ('a stage page's lead section')."
acceptanceCriteria:
  - "viewer-architecture.md states at most one lead section per stage"
  - "The in-app guide's Plan text describes the capture tile and More modal"
  - "docs/packages/web.md and the smart-add-input header describe the capture tile, not a lead-section bar"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
