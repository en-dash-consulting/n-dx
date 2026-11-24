---
"@n-dx/web": patch
---

The Analyze page's top row is now two tiles: "Codebase at a glance" with the charts and headline numbers, and "Recommended fixes" listing every recommendation with its fix.

The left tile holds only visuals: the health and infrastructure stat cards, totals, the languages pie, the largest zones and files by role. Zones with issues keep their "!". The right tile lists next steps, readiness gaps, problems, suggestions, architecture findings and files to move, each with "+ PRD", and nothing in it is repeated on the left.

Clicking a highlighted element on the page filters the recommendations to it: Avg cohesion, Avg coupling, SDLC readiness, Cross-zone imports, or a zone marked "!". Hovering one highlights the matching recommendations. The filter chip above the list clears it. Inside the opened visuals tile the cards scroll to the sections that explain them instead. The codebase map below is unchanged. Zones, Files, Architecture and Routes are now tabs of the opened visuals tile.
