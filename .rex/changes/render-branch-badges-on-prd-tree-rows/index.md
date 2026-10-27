---
id: "982777ca-fa74-4b7a-ae46-5c4329cf8ace"
type: "change"
title: "Render branch badges on PRD tree rows and add branch filter to toolbar"
slug: "render-branch-badges-on-prd-tree-rows"
intent: "Display a compact branch badge on each PRD tree row (epic, feature, task, subtask) when `branch` is set, and add a branch filter control to the tree toolbar so users can focus the view on items belonging to a specific branch. Items without attribution display no badge. The filter should be unobtrusive when only one branch is present."
acceptanceCriteria:
  - "Each tree row renders a visually distinct badge showing the branch name when the item has `branch` set"
  - "Items without `branch` attribution show no badge and no empty placeholder"
  - "Hovering or clicking the branch badge shows a tooltip with the full `sourceFile` path"
  - "Branch badges are visually distinct from existing status badges (color, shape, or prefix)"
  - "A branch filter dropdown appears in the PRD tree toolbar only when items from more than one branch are present in the loaded data"
  - "Selecting a branch in the filter hides items whose `branch` does not match; selecting 'All' restores the full tree"
  - "Filter state is preserved through same-session navigation (e.g., switching tabs and returning)"
  - "No visual regression on tree rows that have no attribution data"
touches:
  - "9f96a45d-092e-4ea2-a76d-b21551cedbba"
priority: "high"
tags:
  - "web"
  - "ui"
  - "dashboard"
  - "preact"
source: "smart-add"
---
