---
"@n-dx/core": patch
---

`ndx start --open` no longer flashes a visible cmd.exe console window on Windows: the browser-opener spawn now passes `windowsHide`, matching the hub and background-server spawns.
