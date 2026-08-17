---
id: "e6f25b4d-ee6a-4dfe-89b6-a6520f3fd0e4"
level: "task"
title: "Implement single terminateTree contract dispatching kill(-pgid) / taskkill /T /F"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "process-lifecycle"
  - "reliability"
  - "core"
blockedBy:
  - "134db348-9786-4723-9d68-501931faa499"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "A single exported terminateTree(child, timeoutMs) replaces the caller-facing choice between group and direct kill"
  - "PLATFORM_SUPPORTS_PROCESS_GROUPS is removed from the module's public exports; no caller branches on process.platform for termination"
  - "The previously-red Windows grandchild e2e assertions now pass, with the assertions themselves unweakened"
  - "POSIX termination behavior (SIGTERM grace period, SIGKILL escalation, timeout semantics) is byte-for-byte unchanged — existing POSIX tests green without modification"
  - "taskkill is invoked through packages/core/win-spawn.js, is awaited with a bounded timeout, and treats 'process not found' as success rather than throwing"
  - "The Windows no-graceful-phase tradeoff and the Job Objects decision are both documented in the module JSDoc"
  - "NDX_DEBUG_LIFECYCLE traces which termination strategy ran"
description: "Replace the caller-visible platform branching in packages/core/child-lifecycle.js with one `terminateTree(child, timeoutMs)` contract that internally selects the OS strategy. BLOCKED BY the un-skip task: the Windows e2e grandchild assertion must be red first so this task has a concrete target to turn green.\n\nCurrent state: `terminateProcessGroup` (POSIX, via `process.kill(-child.pid, SIG)`) and `terminateChildProcess` (direct child only) are selected at tracker-construction time by `processGroups && PLATFORM_SUPPORTS_PROCESS_GROUPS`, and `PLATFORM_SUPPORTS_PROCESS_GROUPS` is exported — leaking the platform question to callers. cli.js additionally branches via `SPAWN_DETACHED`.\n\nTarget: `terminateTree` keeps the existing SIGTERM-then-escalate shape on POSIX, and on Windows escalates via `taskkill /PID <pid> /T /F` (spawned through the existing Windows-safe recipe in packages/core/win-spawn.js — do NOT hand-build a cmd line here). Stop exporting `PLATFORM_SUPPORTS_PROCESS_GROUPS` from the module's public surface; the `processGroups` option becomes unnecessary if tree-kill is the universal default, so consider removing it rather than keeping a no-op flag.\n\nWindows tradeoff to document, not paper over: `taskkill /T /F` is force-only, so there is NO graceful phase on Windows — the POSIX SIGTERM grace period has no equivalent. Either accept that (documented) or attempt a graceful pass first via `taskkill /T` without `/F`. Job Objects are the architecturally correct primitive (kill-on-close, exactly analogous to process groups) but require a native addon; explicitly record why they were or were not chosen.\n\nRoute the strategy selection through the existing NDX_DEBUG_LIFECYCLE flag so a run can be traced to the branch that executed. Note that `taskkill` is spawned during shutdown, possibly under a signal handler — it must be awaited with a bounded timeout and must not throw if the tree is already gone (a non-zero exit for \"process not found\" is a normal race, not an error). Also verify behavior when the ndx process itself is being force-killed: taskkill may not get the chance to run, which is a real limitation worth stating."
---
