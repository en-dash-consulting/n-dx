---
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

A website open in the user's browser can no longer make the dashboard spawn `ndx` through the prepare routes.

`GET /api/hench/prep/:taskId` and `GET /api/hench/ready` answer 403 to a foreign `Origin` or a `Sec-Fetch-Site` other than `same-origin`/`none`; header-less CLI requests still work. Prep and preview spawns are capped at 4 in flight (429 beyond), identical prep resolves share one spawn, and a client disconnect kills the child. `exec` gains a `signal` option to support this.
