---
id: "58161d5e-ae2a-45aa-9dec-10036b3cf74d"
level: "task"
title: "Spawn exec's children through spawn so POSIX can create a real process group"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "process-lifecycle"
  - "llm-client"
  - "correctness"
acceptanceCriteria:
  - "exec spawns via spawn, and options passed to it demonstrably reach the child — asserted by a test that would fail under execFile's option-dropping"
  - "A child spawned by exec on POSIX is a process-group leader, proven by a real-process test that kills the group and observes descendants die"
  - "The full ExecResult contract is unchanged: never rejects, string stdout/stderr, exitCode null on kill by timeout OR external signal, maxBuffer enforced, stdin closed immediately"
  - "Mock-based tests that reach exec are repointed from execFile to spawn, with no assertion weakened to accommodate the change"
  - "The integration test that caught this (exec-timeout-tree-kill) passes on POSIX in CI, not only on Windows"
description: "PREREQUISITE for the freeze-verify-kill work. Until this lands, no POSIX containment primitive is available to `exec` at all.\n\nTHE DEFECT, verified rather than reasoned about: `child_process.execFile` builds its own options object for `spawn` and silently drops anything outside its curated set. `detached` is not in that set, so it never arrives. Confirmed on this machine by passing `stdio: \"ignore\"` to execFile — also dropped, the streams are still piped.\n\nConsequence: a child spawned through `exec` is never a process-group leader, `process.kill(-pid, ...)` fails with ESRCH, and only the direct child dies. ubuntu CI caught this after it shipped: a timed-out command's grandchild survived and wrote 13 more marker files (17 vs 4) with the pid still alive. It passed on Windows purely because `taskkill /T` walks the tree by PID and needs no group.\n\nNote how it got through: the unit tests inject the kill, so they prove the SHAPE of the decision, not that the syscall does what was assumed; and the integration test had only ever run on Windows. An injected seam is not evidence about the kernel.\n\nWHAT TO DO: implement `exec` on top of `spawn` and buffer output manually, so spawn options actually take effect. The current public contract must be preserved exactly:\n- resolves, never rejects\n- `stdout` / `stderr` as strings\n- `exitCode: null` when the process was killed (timeout OR an external signal — this was over-narrowed once already and had to be restored)\n- `error: Error | null`\n- maxBuffer enforcement, including killing the child and surfacing the ERR_CHILD_PROCESS_STDIO_MAXBUFFER-equivalent\n- `child.stdin.end()` immediately, so a child that reads stdin in a non-TTY does not hang forever waiting for EOF (see the comment in exec.ts — this was a real bug)\n\nThen `treeKillSpawnOptions` becomes genuinely effective for exec callers and the group kill stops being dead code on POSIX. Keep the ps-based descendant sweep as the fallback for callers that did not spawn detached.\n\nBLAST RADIUS, the reason this is its own task: several test files mock `node:child_process`'s execFile and reach it through exec. They will need to mock `spawn` instead — at least packages/llm-client/tests/unit/exec.test.ts, packages/llm-client/tests/unit/auth.test.ts (detectCliAvailability), and packages/hench/tests/unit/process/exec.test.ts. These are mock-shape changes, not semantic ones, but they are why this is not a two-line edit.\n\nDo NOT keep two code paths (execFile when treeKill is off, spawn when on). Divergent paths in the one function every package routes through is how the original asymmetry survived unnoticed."
---
