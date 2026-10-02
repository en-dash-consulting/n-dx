---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

The Analysis page now opens on the isometric codebase map. It sits under a one-line bar with the analysis branch, commit, age and the Re-analyze controls, and is followed by a row of stat tiles (files, zones, circular deps, average cohesion and coupling, signals) and a Next Steps panel that collapses to one summary line. Expand takes the map full screen, and Terrain starts collapsed since the page already leads with the map.

`renderIsoMap` gains an `embed` option, requested by the dashboard with `GET /api/iso-map?embed=1`: the document fills its frame without scrolling, keeps only the level crumbs and camera tools as floating controls, drops the footer, and opens the details panel only for a selection. A plain scroll wheel is left to the host page, so scrolling past the map scrolls the page; Ctrl/⌘ + scroll or a pinch zooms, and the host can turn plain-wheel zoom on (full screen) and set the colour scheme over `postMessage`. New-tab and download links, `sv iso` and the `/iso-map` skill still produce the standalone page.

Legend filters on the map now match nested zones: an area stays lit when any zone or sub-zone inside it has an active kind, the matching tiles on its face take the kind's colour, and each legend entry shows how many zones of that kind exist at every depth.

The Plan page opens on a one-row Smart Add bar (description, Generate, and a "More" toggle for batch import, project scan and recent activity) instead of the full form, and the Work dashboard's duplicate Smart Add card is gone. The Plan page's Tasks section reads title → progress → one toolbar row (search, status and tag filters, item actions) → tree, with the hierarchy explainer moved to an ⓘ beside the title. Stage page headers are one compact line, and both pages fit any viewport: the top navigation scrolls inside its bar on phones, the side stage links give way there, and tooltips stay on screen.
