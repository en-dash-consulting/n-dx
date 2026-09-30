---
"@n-dx/web": patch
---

Dashboard: merge the Analysis stage's Map, Isometric map and Zones into one
tabbed Terrain section, and Architecture and Routes into one tabbed
Architecture section.

The Analysis stage showed the repository map (with a 2D/3D toggle to the
isometric map), Zones, Architecture and Routes as four separate collapsible
sections. `StageSection.alt` — the old two-way 2D/3D toggle — generalises into
`tabs`, an ordered list of further views sharing a section; each tab is still
the same view, unchanged, reused as its own route and full page. The tab strip
is a proper ARIA tablist (`role="tab"`/`"tabpanel"`, `aria-selected`,
roving-tabindex arrow-key navigation), replacing the toggle's plain pressed
buttons. Terrain has no page of its own, so its heading comes from a new
per-section `group` override; the merged Architecture section keeps the
`architecture` view's own name, needing no override. A section's "Open" link
still opens whichever tab is active. The isometric map tab stays hidden in a
static export, the same exemption the old toggle's 3D side carried.

Rex's merge graph (`merge-graph`) is relabelled **PRD Graph**; it was
**Context Graph**. Its heading, display-mode control, screen-reader label and
the link to it from the PRD view all use the new name.
