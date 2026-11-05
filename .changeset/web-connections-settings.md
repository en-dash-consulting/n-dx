---
"@n-dx/web": patch
---

Settings > Project lists the Sidecar's connections with their state while `web.sidecar` is on, and signs OAuth connections in and out. The sign-in returns to the dashboard page, which finishes it through an authenticated route; `/api/connections` and its OAuth routes need the per-user token or a browser session and never return a token or code.
