---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

New `ndx work --plan-queue [--format=json]` suggests which ready tasks of a v2 PRD can run side by side, using fixed rules and no model call. It groups up to 3 light- or standard-tier tasks of one change into a lane, in dependency order, and prints the command that runs the lane. Lanes offered together come from changes whose `touches` do not overlap, and a change with no `touches` runs alone. Tasks tagged `review-critical`, `migration` or `cross-package` are left out. The plan never offers more lanes than `guard.maxConcurrentProcesses` minus the runs active now, counted in every worktree of the repository. Every ready task is listed once, in a lane or left out, with a one-line reason. The command only prints: it starts no run, claims no task and writes no file.

A new experimental toggle, `hench.readyNext` (off by default), replaces the Up next list on Live with Ready next, which shows each lane's command and the reasons for every task in or out. Each task title opens the task, as Up next items do.
