---
"@n-dx/web": patch
---

A Sidecar run that fails after `start_work` said it started (hench refusing past the starting phase, or failing later) is now reported to the agent: the session's next turn opens with the run, its task, its exit code and the end of hench's output.
