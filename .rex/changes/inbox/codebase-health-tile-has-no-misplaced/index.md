---
id: "8df23503-a824-4f3c-8a0b-eef90973bccc"
type: "change"
title: "Codebase health tile has no misplaced or clipped info tips"
slug: "codebase-health-tile-has-no-misplaced"
intent: "User (2026-10-15): \"these i icons are misplaced sometimes and cut off in the tile.\" In the compact stat grid the ⓘ InfoTip lands on the stat card's edge when the label is long (AVG COHESION), and its bubble is clipped by the tile's overflow and fade. The tile is a summary: hide info tips in tiles and keep them in the opened tile; keep stat labels on one line, truncating rather than colliding."
acceptanceCriteria:
  - "No info-tip icon renders inside a dashboard tile's preview."
  - "The opened Codebase health tile still shows the info tips, with room for their bubbles."
  - "Stat labels in the tile stay on one line within their card."
priority: "low"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "dashboard"
source: "ndx-capture"
---
