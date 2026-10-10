---
"@n-dx/core": patch
---

`ndx start --open` on Windows opens the dashboard through `rundll32.exe
url.dll,FileProtocolHandler` instead of `cmd.exe /c start`, so no shell sees the
URL and a `%NAME%`-shaped sequence in the token or project id is no longer
expanded.
