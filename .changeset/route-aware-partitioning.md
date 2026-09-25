---
"@n-dx/sourcevision": patch
---

Zones understand file-based routing. React Router/Remix, Next and SvelteKit route roots are detected from the inventory. Route directories no longer name zones (no more `routes-2`, `routes-3`, …), each route feature's files are grouped together instead of by the shared components they import, and a zone's route path is offered as a name. The zone algorithm version is now recorded in `zones.json`; a partition from an older version is re-derived rather than reused or used as a seed, and names chosen earlier carry over to the new zones.
