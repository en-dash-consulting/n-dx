---
"@n-dx/core": patch
---

`ndx pair-programming` prints the v1 deprecation notice once, and both hench runs it spawns (the task and the remediation pass) get `NDX_AGENT_RUN=1` and `NDX_LEGACY_NOTICE=off`, so the agent cannot run `ndx migrate`.
