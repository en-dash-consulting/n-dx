---
id: "536c72d7-d8d3-410b-8710-67e24e330690"
type: "change"
title: "Audit current animation frames against Rex-F.png and identify divergences"
slug: "audit-current-animation-frames-against"
intent: "Render each current ASCII animation frame side-by-side with Rex-F.png to document exactly where the existing sequence diverges from the reference. Identify which frames are misaligned in proportions, pose, or character anatomy. Produce a written frame-by-frame audit that will drive the subsequent correction work."
acceptanceCriteria:
  - "Every current animation frame is compared against Rex-F.png and differences are documented"
  - "Audit output identifies which frames require redrawing vs minor adjustment"
  - "Audit is committed as a markdown or inline comment artifact so future contributors can reference it"
touches:
  - "6db5328c-2df6-437a-80a1-771fa55401a5"
priority: "high"
tags:
  - "cli"
  - "animation"
  - "ascii-art"
source: "smart-add"
---
