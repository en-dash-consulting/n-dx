---
id: "797fa0aa-caa0-433f-aa50-de87f0c05e90"
type: "capability"
title: "Checkbox multi-select and detail panel UX for PRD tree"
slug: "checkbox-multi-select-and-detail-panel"
statement: "The PRD tree reveals a checkbox on each row for multi-selecting items for bulk actions, and opens an item's detail side panel when the row itself is clicked."
criteria: [{"id":"c1","text":"When the user clicks a PRD tree row outside its checkbox, the PRD tree shall open the detail side panel for that item."},{"id":"c2","text":"While the detail panel is open for an item, the PRD tree shall show that item's checkbox without adding the item to the multi-select set."},{"id":"c3","text":"While the detail panel is open for an item, when the user checks that item's checkbox, the PRD tree shall add the item to the multi-select set."},{"id":"c4","text":"When the user hovers over a PRD tree row, the PRD tree shall show a checkbox on the left side of the row."},{"id":"c5","text":"The PRD tree shall hide a row's checkbox unless the row is hovered, the item is in the multi-select set, or the item's detail panel is open."},{"id":"c6","text":"When the user clicks a row's checkbox, the PRD tree shall toggle that item in the multi-select set without opening the detail panel."},{"id":"c7","text":"While any item is in the multi-select set, the PRD tree shall show the bulk action bar."},{"id":"c8","text":"While an item is in the multi-select set, the PRD tree shall keep that item's checkbox visible without hover."},{"id":"c9","text":"The PRD tree shall show no Edit icon on its rows."},{"id":"c10","text":"The detail panel shall provide the way to edit a PRD item."}]
priority: "medium"
---

Rework the PRD tree row interaction model. Hovering a row reveals a checkbox. Clicking the checkbox enters multi-select mode and shows the bulk action popover. Clicking the row itself (not the checkbox) opens the detail side panel. While the detail panel is open for an item, show its checkbox but don't auto-select it into multi-select. Remove the Edit icon on the right side of rows.
