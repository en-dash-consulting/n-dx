---
"@n-dx/core": patch
---

`ndx self-heal`, `start` and `web` print the v1 deprecation notice once and silence it for their children. The hench run that `ndx work` and `ndx self-heal` spawn gets `NDX_AGENT_RUN=1` and `NDX_LEGACY_NOTICE=off`, and `ndx migrate` (bare, `--plan` and `--apply`) refuses while `NDX_AGENT_RUN` is set: an operator runs the migration from their own shell.
