---
id: "411b7e86-f9e9-421f-96db-e6c924d64fc0"
level: "task"
title: "Define geometric decoration tokens and CSS primitives for dashboard"
status: "completed"
priority: "high"
tags:
  - "web"
  - "ui"
  - "design-system"
source: "smart-add"
startedAt: "2026-05-14T18:01:51.069Z"
completedAt: "2026-05-14T18:06:54.989Z"
endedAt: "2026-05-14T18:06:54.989Z"
resolutionType: "code-change"
resolutionDetail: "Extended decorations.css with full token set (stroke-width, dash patterns, opacity tiers, z-index) and reusable utility classes (.deco-dot-grid, .deco-arc-corner-br, .deco-circle-tr, .deco-ruled-h/v, [data-deco-num]). Created components/decorations.ts with 5 exported Preact primitives (DecoConcentricArcs, DecoDotGrid, DecoBorderCircle, DecoRuledLines, DecoLargeNumeral). Exported from components/index.ts barrel. Allowed/disallowed vocabulary documented in decorations.css header. Zero emoji or raster image decorations in viewer source."
acceptanceCriteria:
  - "CSS custom properties for stroke width, dash pattern, opacity, and decoration color exist in a single shared stylesheet consumed by the dashboard"
  - "Reusable SVG/CSS primitives for dot grid, concentric arc set, thin border circle, ruled line, and large numeral are exported and usable in any dashboard view"
  - "A short doc (markdown or code comment in the design tokens file) lists allowed and disallowed decorative patterns including the explicit ban on images, emoji, clip-path blobs, and gradient splashes"
  - "No raster image assets or emoji characters are added to the dashboard for decorative purposes; grep over viewer source confirms zero emoji/image decorations introduced by this change"
description: "Create a centralized set of CSS custom properties and reusable utility classes / SVG components for the approved decorative vocabulary: dot grids, concentric arcs, thin border circles, ruled horizontal/vertical lines, and oversized background numerals. Tokens should cover stroke widths, dash patterns, opacity tiers, and z-index layering rules so decorations remain visually subordinate to content. Document allowed vs disallowed shapes (no clip-path blobs, no gradient splashes, no organic forms, no images, no emoji) in a short style note inside the web package."
---
