---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Sidecar's Diagnose run lens reads the task's newest run in any worktree of the repository and names the worktree it came from. A run still recorded as running whose process is gone is no longer told to the model as still running: it is classified, and the packet says that ending it from Live records the end. `hench runs diagnose` classifies such an orphaned run the way ending it would record it, without saving anything.
