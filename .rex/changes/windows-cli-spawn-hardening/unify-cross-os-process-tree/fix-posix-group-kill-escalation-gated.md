---
id: "deb8d3f6-17c9-4157-b4aa-1689e8249e6b"
type: "subtask"
title: "Fix POSIX group-kill escalation gated on the direct child instead of the group"
slug: "fix-posix-group-kill-escalation-gated"
description: "PRE-EXISTING LEAK in the POSIX process-group path of packages/core/child-lifecycle.js, present since the tracker was written and faithfully preserved through the terminateTree refactor.\n\n`terminateProcessGroup` sent SIGTERM to the group, then gated escalation on the DIRECT CHILD:\n\n    await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);\n    if (!isChildRunning(child)) return;            // <-- gates on the child\n    try { killGroup(-child.pid, \"SIGKILL\"); } ...  // <-- escalation for the group\n\nFailure sequence, which is the common case rather than an edge case:\n1. SIGTERM is delivered to the whole group.\n2. The leader has a SIGTERM handler (or default-terminates) and exits promptly.\n3. A grandchild ignores or blocks SIGTERM — routine for long-running CLIs and daemons, including the claude/codex processes ndx spawns.\n4. `waitForChildExit(child)` resolves because the LEADER exited.\n5. `!isChildRunning(child)` is true, so the function returns.\n6. SIGKILL never reaches the group; every surviving member is stranded.\n\nThe leader's exit carries no information about the group's state, so this defeats the exact leak that process groups exist to prevent.\n\nSCOPE NOTE: this is POSIX signal semantics, so it affects macOS as well as Linux — not a Linux-only concern. macOS is a supported platform, which is why this is filed at high priority despite Linux not being officially supported.\n\nFIX: wait on the group and escalate on the group.\n- `groupHasMembers(pgid, killGroup)` probes with signal 0 (kernel existence check, delivers nothing).\n- `waitForGroupExit(pgid, killGroup, timeoutMs)` polls that probe on a bounded deadline instead of awaiting the child's \"exit\" event, so all members get the grace period.\n- Escalation now runs when the GROUP still has members, regardless of the leader.\n\nPID-reuse safety: a pgid stays allocated while the group has members, and a pgid is its leader's PID, so that PID cannot be recycled while anyone remains in the group — probing immediately before signalling cannot hit an unrelated process. If the group drains in between, the signal fails ESRCH and is swallowed.\n\nNOT FIXED (recorded, judged not live): terminateTree's top-level `if (!isChildRunning(child)) return` means a child that exited before cleanup gets no tree kill even if its grandchildren survive — on both platforms. Not reachable through the tracker, which unregisters children on \"exit\"/\"close\", so cleanup never sees an exited child. It would only bite a direct terminateTree caller.\n\nVERIFICATION CONSTRAINT: the real `process.kill(-pgid)` path cannot be exercised from a Windows host. Proven instead through the injected `killGroup` seam with `platform: \"linux\"` — a mock where the leader obeys SIGTERM while the group retains a member. That test failed with `expected [] to deeply equal [[-4321, \"SIGKILL\"]]` before the fix. Real-signal coverage comes from the e2e cleanup suites on Linux CI."
acceptanceCriteria:
  - "Escalation to SIGKILL depends on whether the process group still has members, not on the direct child's liveness"
  - "A test proves the leak: leader exits on SIGTERM while a group member survives, and SIGKILL is still delivered to the group"
  - "A test proves the converse: a group that drains during the grace period is never SIGKILLed"
  - "The group-existence probe uses signal 0 and its PID-reuse safety argument is documented at the call site"
  - "Waiting is bounded — a group that never drains cannot wedge shutdown"
  - "Windows taskkill behavior is untouched"
tags:
  - "posix"
  - "linux"
  - "macos"
  - "process-lifecycle"
  - "core"
  - "bug"
source: "exploration-2026-08-17"
priority: "high"
---
