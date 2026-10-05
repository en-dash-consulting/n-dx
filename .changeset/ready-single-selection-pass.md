---
"@n-dx/web": patch
---

`GET /api/hench/ready` orders its rows with one selection pass instead of one next-task search per row. On a 1,800-item PRD the request took about 5 s on the server's event loop and now takes a fraction of a second.
