---
"@n-dx/hench": patch
---

Stop the timed-out test gate test racing its fake gate's startup: the gate now gets 5 s before the timeout fires, so a slow `sh` start can no longer kill it before it logs its call (#564).
