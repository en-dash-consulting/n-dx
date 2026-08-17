---
id: "042a5aac-09c4-4499-96af-a7c2c75dbb78"
level: "task"
title: "Route ndx start stop through the unified terminateTree contract"
status: "pending"
priority: "medium"
tags:
  - "cross-os"
  - "windows"
  - "process-lifecycle"
  - "core"
  - "web"
blockedBy:
  - "e6f25b4d-ee6a-4dfe-89b6-a6520f3fd0e4"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "web.js stopServer uses the shared termination primitive rather than its own SIGTERM/SIGKILL sequence"
  - "`ndx start stop` terminates the server's child processes on Windows, not just the recorded server PID"
  - "The PID-only vs ChildProcess distinction is handled explicitly; pid-file staleness and zombie/PID-reuse handling are preserved"
  - "web.js's 2 000 ms grace period (and N_DX_STOP_GRACE_MS override) still applies — stop-command latency is unchanged"
  - "Exactly one SIGTERM-grace-SIGKILL escalation implementation remains in packages/core"
  - "A test covers `ndx start stop` leaving no orphaned children on Windows"
description: "packages/core/web.js contains a SECOND process-termination implementation that does not share code with child-lifecycle.js:\n\n- :169-176 `isProcessRunning(pid)` — `process.kill(pid, 0)` liveness probe\n- :188-195 `waitForProcessExit(pid, timeoutMs, intervalMs)` — poll loop\n- :212+ `stopServer(...)` — SIGTERM, wait out `gracePeriodMs` (default 2 000 ms, overridable via N_DX_STOP_GRACE_MS), then SIGKILL\n\nThis duplicates the SIGTERM→grace→SIGKILL escalation that child-lifecycle.js already implements, and inherits the same Windows deficiency independently: SIGTERM maps to TerminateProcess on Windows, so the background server never runs its cleanup handlers, and only the recorded server PID is signalled — any child the server spawned is orphaned. `ndx start stop` on Windows can therefore leave the port held or child processes running.\n\nBLOCKED BY the terminateTree task: this should consume that contract rather than grow a parallel Windows fix, otherwise the codebase ends up with two divergent tree-kill implementations — the exact problem this task exists to remove.\n\nThe wrinkle to solve deliberately: child-lifecycle's terminate functions operate on a live ChildProcess object (they use child.exitCode/signalCode and listen for 'exit'/'close'), whereas stopServer has only a PID read from .n-dx-web.pid across process boundaries. Either generalize terminateTree to accept a bare PID alongside a ChildProcess, or extract the PID-level escalation core and let both call it. Note that a PID-only path cannot distinguish a reaped process from a reused PID, so keep the existing pid-file staleness handling (cli.js:715 already comments on kill(pid,0) succeeding for zombies) rather than assuming the shared helper covers it.\n\nAlso reconcile the grace periods: web.js defaults to 2 000 ms for CLI responsiveness while child-lifecycle defaults to 5 000 ms. Keep them independently configurable — do not silently change stop-command latency as a side effect of consolidating."
---
