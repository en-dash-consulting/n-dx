---
"@n-dx/web": patch
---

The dashboard's Plan, Inbox and Analysis pages now show Prioritized tags everywhere, a full-width assignee field, a padded capture box, steady tiles while loading, and named placement targets.

- The `/inbox` triage queue marks a prioritized change with the same Prioritized tag as the Plan Inbox tile, the Open changes glance and the Changes list.
- In the change detail panel the assignee field takes the whole row, so `Name <email>` reads in full, and its Save, Unassign and Cancel buttons match the panel's other small buttons. At phone width they wrap without a sideways scroll.
- The Describe a change box on Plan grows as its text wraps, keeping its inner padding instead of scrolling the text flush against the border.
- Plan's tiles hold their final slots from the first paint: before the project's PRD layout is known, Open changes, the Inbox and Specs to tighten show a loading placeholder in place instead of the grid packing without them and rearranging.
- While the analysis is still being read, the Analysis page says "Loading the analysis…" instead of "Getting Started: complete the analysis" and "No inventory loaded". Getting Started still shows once loading finishes and finds no import graph or zones.
- Plan's "How planning works" Capture step names the Describe a change tile instead of the old capture bar.
- In the placement panel, Place & next and Place & add another name the chosen relation and target, like the main button ("Amend Refunds & next"); a long target is shortened, with the full name in the tooltip.
- The placement panel's search box and Touches/Amends choice use the dashboard's input and choice styles in light and dark themes, with a visible focus ring. The keyboard works as before.
