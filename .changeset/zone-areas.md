---
"@n-dx/sourcevision": patch
---

The architecture map opens on areas instead of every zone. `zones.json` now groups zones into 4–10 areas: route-app containers and monorepo packages start as areas, the rest are grouped by imports without letting one area take over, and test suites join the area they test. Areas with a composite name get a judged or generated one. The iso map draws one block per area with its zones as tiles, **Open** (or double-click) drills into an area's zones with a breadcrumb back, and an over-tall dependency column now wraps into several instead of drawing as one long diagonal.
