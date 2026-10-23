---
id: "4740f527-ac08-4a59-a20f-ce6854900296"
type: "change"
title: "Isometric map zooms faster on a trackpad pinch and a little faster on ⌘/Ctrl + scroll"
slug: "isometric-map-zooms-faster-on-a"
intent: "User (2026-10-15): \"make the zoom of the isomap a bit more sensitive too. have to do too much to zoom in, too much pinching to scroll. keyboard scroll is pretty good, but could also be a smidge faster.\" The map's wheel handler (packages/sourcevision/src/export/iso-map.ts) zooms by exp(-deltaY × 0.0016) for every wheel event. A trackpad pinch arrives as ctrlKey wheel events with small fractional deltas, so it barely zooms; ⌘/Ctrl + mouse wheel sends ~100 per notch. Give pinch its own, much higher rate and raise the modifier-wheel rate slightly; normalise line-mode deltas; bound the per-event step. Regenerate the /iso-map skill script (scripts/build-iso-skill.mjs) so the drift test stays green."
acceptanceCriteria:
  - "A trackpad pinch (ctrlKey wheel events with small deltas) zooms several times faster than before."
  - "⌘/Ctrl + mouse wheel zooms somewhat faster per notch than before."
  - "No single wheel event zooms by more than 2× or less than ½×."
  - "The generated .claude/skills/iso-map/scripts/iso-map.mjs is regenerated and tests/e2e/iso-skill-drift.test.js passes."
priority: "medium"
tags:
  - "sourcevision"
  - "web"
  - "iso-map"
  - "ui"
source: "ndx-capture"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Optional 3D isometric architecture map generator" (f666d3ed-3625-4468-8048-b9cd6b5fe011).
