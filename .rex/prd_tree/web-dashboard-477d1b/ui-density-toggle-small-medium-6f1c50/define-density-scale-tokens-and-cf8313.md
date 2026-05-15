---
id: "cf8313d3-00a7-4747-8e33-408128b6e84f"
level: "task"
title: "Define density scale tokens and CSS variables for small/medium/large UI sizing"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "design-system"
source: "smart-add"
startedAt: "2026-05-14T19:09:45.608Z"
completedAt: "2026-05-14T19:14:09.638Z"
endedAt: "2026-05-14T19:14:09.638Z"
acceptanceCriteria:
  - "A `data-density` attribute on the root element with values `small`, `medium`, `large` swaps a single set of CSS variables"
  - "Medium density renders pixel-identical to the current UI in a visual diff of the PRD tree, sidebar, header, and detail panel"
  - "Small and large densities scale font size, padding, and row height consistently across primary views (PRD tree rows, sidebar items, header controls, detail panel)"
  - "No component contains hard-coded sizing that ignores the density tokens for the properties listed above"
description: "Introduce a density design-token layer (CSS variables) covering font sizes, line heights, paddings/margins, row heights, control sizes, and icon sizes. Medium captures the current dashboard sizing as the baseline; small and large scale those tokens by fixed ratios (e.g. ~0.875x and ~1.125x). Existing component styles should be refactored to consume these variables instead of hard-coded pixel values so the toggle can switch density without per-component changes."
---
