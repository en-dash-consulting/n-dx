---
"@n-dx/hench": patch
---

The CLI agent brief no longer claims a test gate follows when `--skip-test-gate` (or `hench.skipFullTestGate`) removes it. Under that flag the brief used to tell the agent not to run the repository suite *because* the gate would, and that finishing was not skipping validation *because* the gate still ran — both false, so the run committed and completed the task with nothing having run the suite. The brief now drops both claims when no gate follows and says so instead: the agent's own checks are the only ones the change gets before it is committed. The reviewer brief already carried this guard.
