---
"@n-dx/web": patch
"@n-dx/sourcevision": patch
---

The Analyze page's codebase map now spans the full width under the top row, marks zones with issues "!" and lights the zones of any recommended fix you hover.

The map replaces the old grid of Zones, Files, Languages, Problems, Suggestions, Architecture and Delivery & infrastructure tiles. Their content now sits in the two tiles above it, "Codebase at a glance" and "Recommended fixes". The Problems, Suggestions, Zones, Files and Architecture pages keep their routes.

Hovering a recommended fix lights the zones it names on the map. When it names no zone the map draws, or acting on it adds files or directories (extracting, splitting, a missing test script or pipeline step), a note beside the map says so. A problem or suggestion that a listed next step already groups is listed only as that step. Problems, suggestions and architecture findings keep their enrichment gates, and the list names the pass that unlocks them.

The embedded isometric map accepts two more host messages: `issues` (zone id to `"warn"` or `"crit"`) puts a "!" on each block that is or holds a listed zone, and `lit` (zone ids, or `null`) lights those blocks and dims the rest.
