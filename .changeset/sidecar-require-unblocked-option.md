---
"@n-dx/hench": patch
"@n-dx/web": patch
---

`requireUnblocked` is a run option: `ndx work --resolve` lists `--require-unblocked` and reports it under `resolved`, and the dashboard's execute route passes it and refuses, naming the open blockers, a task whose blockers are not completed. A Sidecar run-plan lane step with `--require-unblocked` now starts from a work card carrying that option, and the work card preview lists the task's unfinished blockers.
