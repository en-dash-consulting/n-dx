---
id: "30921544-26cb-49a6-bac2-cee4e10902f3"
type: "task"
title: "Sidecar run_command returns the command's output to the agent"
slug: "sidecar-run-command-returns-the"
description: "Found in story 12's browser check (task 2f15d421): an approved run_command returns as soon as the job starts, so the agent reads only 'Started ndx status . as job sidecar-command-…' and cannot answer from what the command printed. In routes-sidecar.ts sidecarActions().runCommand calls startSidecarCommand (routes-commands.ts), which launches the workspace's sidecar-command job through launchAsyncJob and returns; the job keeps its output and exit in its AsyncJob status (sidecarCommandJobs). Make runCommand wait for that job to finish, up to a bound (default 60 s), then return the exit status and the tail of the output, capped (for example the last 80 lines and at most 8 KB, saying how much was cut). A job still running at the bound returns 'still running as job <id>; output in the job tray and on Live', and the job carries on. A turn stopped while waiting returns at once with the same still-running text, and the job carries on. The job still shows in the tray and on Live while it runs, and Stop in the tray ends it. Nothing else changes: the allow-list, the card, the ndx/git-only rule and the one-at-a-time rule stay as they are. No node:child_process in web."
acceptanceCriteria:
  - "A command that finishes within the bound returns its exit status and the tail of its output in the tool result (tested)"
  - "Output over the cap is cut to its last lines, and the result says how much was cut (tested)"
  - "A command still running at the bound returns that it is still running with its job id, and the job carries on in the tray (tested)"
  - "A turn stopped while the command runs returns at once without stopping the job (tested)"
  - "A command that fails returns its non-zero exit status and its output tail (tested)"
  - "No web module imports node:child_process (policy test passes)"
priority: "high"
source: "browser-check"
---
