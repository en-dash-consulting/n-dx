---
"@n-dx/web": patch
---

Fix project-settings validation of `sourcevision.zones.mergeThreshold`: the dashboard capped it to 0–1 as if it were a Louvain modularity ratio, but it is the small-zone merge threshold — a minimum zone size in files, default 3. The server route and settings view now accept any non-negative integer, and the field's description, placeholder, and default hint describe the real semantics.
