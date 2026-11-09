---
"@n-dx/web": patch
---

Start Working's one click no longer saves the project defaults on a task before the run is accepted. The defaults now travel with the execute as `saveRun: {run, version}`, and the server saves them (through the same path and version check as the Prepare task modal's Save) only after every execute gate has passed, right before it spawns — so a start refused because executions are paused, the task is already running, claimed by another worktree or blocked leaves the task's settings and the working tree unchanged. A queued run carries `saveRun` through the hub's queue and saves it when it actually starts; a version conflict refuses the start with 409.
