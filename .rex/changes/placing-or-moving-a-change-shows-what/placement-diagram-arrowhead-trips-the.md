---
id: "637815a4-4efb-45d4-b7b1-77327d75c50c"
type: "task"
title: "Placement diagram arrowhead trips the no-left-stripe style rule"
slug: "placement-diagram-arrowhead-trips-the"
summary: "The arrowhead in the placement diagram is drawn in a way the dashboard's style rules forbid, which breaks a style test; redraw it so the test passes again."
description: "Found on integration/plan-analyze-stack: the `.pp-edge-line::after` arrowhead in `packages/web/src/viewer/styles/prd-tree.css` (from commit 571877412) uses `border-left-color: currentColor`, which `tests/unit/viewer/no-left-stripe-emphasis.test.ts` reports as a left-stripe emphasis. The test fails on the base branch."
acceptanceCriteria:
  - "The placement diagram arrowhead is drawn without a left-border color (for example an SVG or clip-path triangle) and looks the same in both themes"
  - "no-left-stripe-emphasis.test.ts passes without adding an exemption for this rule"
priority: "medium"
source: "ndx-capture"
---
