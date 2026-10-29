---
"@n-dx/web": patch
---

Sidecar carries out approved broker calls (behind `web.sidecar`). An approved or allow-listed `run_command` runs as the workspace's Sidecar command job, shown in the job tray and on Live. The agent waits up to 60 s for it: the tool result carries the exit status and the output's last 80 lines (at most 8 KB, saying how much was cut), or says the command is still running as its job. A turn stopped while waiting answers at once and leaves the job running. A `start_work` card shows the task's `ndx work --resolve` before approval; approval starts the run through the hench execute route, refused at `guard.maxConcurrentProcesses`. `start_work` now takes the execute route's `options` instead of raw flags. Other approved tools report "recorded, not carried out yet" and name the batch that will carry them out.
