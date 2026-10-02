---
"@n-dx/web": patch
---

Show repository trust in the dashboard: a strip at the top of every page while the checkout's execution config is not trusted, with the findings and a "Trust this configuration" action (`GET /api/trust`, `POST /api/trust/accept`, `POST /api/trust/revoke`). `ndx start` prints the same review on startup when it applies.
