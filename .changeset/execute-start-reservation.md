---
"@n-dx/web": patch
---

Two near-simultaneous `POST /api/hench/execute` requests for one task no longer both spawn a run: the task is reserved before the checks are awaited, and the second request answers 409 "already starting". A spawn that throws now answers 500 with the reason.
