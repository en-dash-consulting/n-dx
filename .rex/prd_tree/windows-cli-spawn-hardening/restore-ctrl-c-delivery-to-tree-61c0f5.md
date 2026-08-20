---
id: "61c0f531-14ce-4572-94ab-f53b15031a48"
level: "task"
title: "Restore Ctrl-C delivery to tree-killable children in exec()"
status: "pending"
priority: "high"
tags:
  - "pr-329-followup"
  - "llm-client"
  - "process-lifecycle"
  - "posix"
source: "PR #329 review comment 3816985307 (ryrykeith)"
acceptanceCriteria:
  - "A Ctrl-C (SIGINT) at the terminal terminates a child spawned by exec() with treeKill enabled, including its descendants, on POSIX"
  - "detached: true is retained on POSIX so process.kill(-pgid) still reaches grandchildren"
  - "Any SIGINT listener installed by exec() is removed when the child settles, so repeated exec() calls do not accumulate listeners or trip MaxListenersExceededWarning"
  - "Windows behavior is unchanged (treeKillSpawnOptions returns {} for win32)"
  - "A test covers interrupt delivery to a child and its descendants on POSIX"
description: "PR #329 review follow-up (unresolved comment on packages/llm-client/src/exec.ts:179).\n\n`treeKill` defaults to `true` in `exec()`, and `treeKillSpawnOptions()` returns `{ detached: true }` on every non-win32 platform (packages/llm-client/src/process-tree.ts:70). A detached child is its own process-group leader, so a terminal Ctrl-C goes to the parent's group only and never reaches the child. There is no SIGINT handling anywhere in packages/llm-client/src to compensate.\n\nThe main victims are the hench agent's `run_command` and `git` tools: a long-running command started through `exec()` cannot be interrupted from the terminal, and the user has to kill the process tree by hand.\n\n`detached: true` itself is load-bearing on POSIX — it is what makes `process.kill(-pgid)` reach grandchildren — so the fix is not to drop it. Either install a group-kill on SIGINT inside `exec()` for the lifetime of the child, or expose a registration hook so a caller (hench, core) can own the interrupt handling. Windows is unaffected: `treeKillSpawnOptions()` returns `{}` there."
---
