---
"@n-dx/web": patch
---

A Sidecar session's MCP config no longer carries the dashboard token, which the session's own Read tool could open. It carries a per-session broker key (`X-Ndx-Sidecar-Key`) that the request gate accepts only on a `POST` to that session's `/api/sidecar/sessions/<id>/mcp`.
