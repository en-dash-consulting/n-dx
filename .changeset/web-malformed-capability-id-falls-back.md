---
"@n-dx/web": patch
---

An address with a malformed capability id, such as `/product/area/<slug>/capability/%E0`, now opens the area instead of throwing during render and blanking the dashboard.
