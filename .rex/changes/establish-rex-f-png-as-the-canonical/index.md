---
id: "42b353ce-031b-4c72-bca3-64983608a8fb"
type: "change"
title: "Establish Rex-F.png as the canonical first animation frame"
slug: "establish-rex-f-png-as-the-canonical"
intent: "Redraw the first ASCII animation frame so it faithfully represents Rex-F.png's proportions, silhouette, and key anatomical landmarks (head, body, tail, limbs). The existing snapshot test must be updated to reflect the corrected frame. This is the reference anchor all subsequent frames are measured against."
acceptanceCriteria:
  - "Frame 0 of the animation matches Rex-F.png proportions as verified by visual inspection"
  - "Existing snapshot test for the dinosaur ASCII art is updated to match the corrected frame 0"
  - "No other animation frames are changed in this task"
touches:
  - "6db5328c-2df6-437a-80a1-771fa55401a5"
priority: "critical"
tags:
  - "cli"
  - "animation"
  - "ascii-art"
source: "smart-add"
---
