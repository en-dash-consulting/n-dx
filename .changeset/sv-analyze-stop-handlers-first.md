---
"@n-dx/sourcevision": patch
---

`sv analyze` installs its SIGTERM/SIGINT handlers before the progress file first says `running`, so a stop sent on seeing it is always recorded and exits 128 + signal instead of killing the process outright (#562).
