---
"@n-dx/core": patch
---

An extension command (`ndx <name>`) no longer starts n-dx's update check, so its stderr carries no n-dx "Update available" line. Built-in commands still check.
