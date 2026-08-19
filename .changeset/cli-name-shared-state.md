---
"@n-dx/web": patch
---

GET /api/project now returns the resolved cliName, and the viewer gains a useCliName() shared-state hook — the single read path for the project CLI name in dashboard components. The default CLI name across all resolvers is now "n-dx".
