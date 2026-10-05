---
"@n-dx/web": patch
---

The notes file a dashboard run's context notes travel in no longer outlives a failed write, a failed spawn or a server shutdown, and a server start removes `ndx-context-*` directories left behind more than a day ago.
