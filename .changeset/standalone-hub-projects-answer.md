---
"@n-dx/web": patch
---

A dashboard served without the hub no longer logs a 404 for `/api/hub/projects` on every page. The project server now answers it with `{ "hub": false }`, which the breadcrumb's project switcher already treats as "no hub".
