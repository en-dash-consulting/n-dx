---
"@n-dx/web": patch
---

The dashboard server turns off rex's v1-layout deprecation notice for the commands it spawns, so a failing rex spawn on a v1 project shows its real error and not the notice first.
