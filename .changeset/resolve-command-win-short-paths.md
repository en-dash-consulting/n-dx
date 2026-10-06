---
"@n-dx/hench": patch
---

`ndx work --resolve` no longer double-quotes Windows 8.3 short paths (such as `C:\Users\RUNNER~1\...`) in its equivalent command. `~` is plain on win32 and stays quoted on POSIX, where a leading `~` is tilde expansion.
