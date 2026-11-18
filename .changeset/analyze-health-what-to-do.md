---
"@n-dx/web": patch
"@n-dx/sourcevision": patch
---

The dashboard's Analyze page now opens on three tiles (Codebase health, Infrastructure & architecture, and Summary) over a full-width codebase map that marks zones with issues "!" and lights the zones of any recommendation you hover.

Codebase health lists next steps, problems and suggestions as one "What to do" list. Each item is tagged Next step, Problem or Suggestion. A problem or suggestion that a listed next step already groups is not listed again. Hovering or focusing Avg cohesion or Avg coupling highlights the items that concern that metric and dims the rest. Clicking either card filters the list to them. Click it again, or the filter chip, to show everything.

Infrastructure & architecture replaces the Delivery & infrastructure and Architecture tiles. It shows SDLC readiness, cross-zone imports and infrastructure as cards over the same kind of list: readiness gaps (weakest practice first, each with what would close it), architecture findings and files to move. SDLC readiness and Cross-zone imports highlight and filter that list the way the health cards do. Summary replaces the Zones, Files and Languages tiles: totals, languages as a pie, the largest zones and files by role.

Hovering an item in either list lights the zones it names on the map. When it names no zone the map draws, or acting on it adds files or directories (extracting, splitting, a missing test script or pipeline step), a note beside the map says so. Problems, suggestions and architecture findings keep their enrichment gates, and the lists name the pass that unlocks them. Opened, each tile lists every item with its detail. The Summary tile adds every language and role, then the Zones and Files views as tabs. Infrastructure & architecture adds each practice's evidence and every resource, then the Architecture and Routes views. The Problems, Suggestions, Zones, Files and Architecture pages keep their routes.

The embedded isometric map accepts two more host messages: `issues` (zone id to `"warn"` or `"crit"`) puts a "!" on each block that is or holds a listed zone, and `lit` (zone ids, or `null`) lights those blocks and dims the rest.
