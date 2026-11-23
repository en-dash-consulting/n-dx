---
id: "3e63dc6a-0686-4785-af01-914d4d1df344"
type: "task"
title: "Product area boxes: one height per row, clickable, three-line summary"
slug: "product-area-boxes-one-height-per-row"
summary: "Make the product-area boxes on Plan line up at one height, open their area when clicked anywhere, and show only the first three lines of each summary with a fade, so the grid reads evenly."
description: "views/plan-areas.ts and the .plan-area rules in styles/stage-tiles.css. Today each box is as tall as its summary and change list (the grid uses align-items: start) and only the area name is a button. Stretch boxes in a row to one height, make the whole box open the area (navigateTo product area/<slug>) while change titles inside keep opening their change, and clamp the summary to three lines with a fade on the third, the full text in a title tooltip. Keep the 'Not in an area' box consistent."
acceptanceCriteria:
  - "Every box in a row of Product areas has the same height"
  - "Clicking anywhere on a box (not only its name) opens that area's page; change titles inside still open the change"
  - "An area summary shows at most three lines, the third fading out, with the full text available on hover"
  - "Keyboard users can open an area from its box (Enter on a focusable box), with a unit test"
  - "A stylesheet test asserts the three-line clamp and equal-height rows"
priority: "medium"
source: "ndx-capture"
---
