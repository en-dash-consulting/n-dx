---
"@n-dx/web": patch
---

A queued dashboard run its project server would refuse is now refused when it is asked for, not queued: the hub asks the new `POST /api/hench/execute/check` before answering 202 and returns the server's 4xx instead. A queued run refused when its turn comes is kept in `GET /api/hub/queue` as `dropped` with the server's status and message, and the Prepare task modal shows "Could not start: …" and offers Execute again. Per-run models from the live catalog still validate after its 10-minute cache expires.
