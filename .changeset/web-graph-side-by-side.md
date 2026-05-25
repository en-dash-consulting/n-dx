---
"@n-dx/web": patch
---

Zone-view layout polish:

- On viewports ≥ 1280px, the Current Selection side panel docks to the right
  of the Zone Map instead of stacking underneath, so the map and the
  selection details share the screen instead of forcing a scroll.
- The Zone Map header "files" stat now shows the selected zone's share of
  the project (e.g. `5 / 102 files`) so the count is anchored to the whole
  codebase instead of reading as an unmoored number.
