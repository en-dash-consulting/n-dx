---
"@n-dx/hench": patch
---

Document that `vendorPid` is the cmd.exe wrapper's pid on Windows, and make the spawn tests assert liveness there instead of equality with the child's own pid.
