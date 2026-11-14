---
id: "ed2f3d51-97a5-4f5b-8b98-2ff2e2667a10"
type: "task"
title: "Add a host-wide validation slot to hench"
slug: "add-a-host-wide-validation-slot-to-hench"
description: "PR 2 of 3 (host-wide validation slot), task 1 of 3. Stacked on PR 1; blockedBy only keeps the stack order.\n\nAdd a new module under packages/hench/src/process/ (for example `validation-slot.ts`) that admits one validation execution at a time per OS user on the host, across hench processes and worktrees. This task builds the module and its tests only; wiring it into the gate is the next task.\n\nLock state lives under the ndx home (`resolveNdxHome`, reached through prd/llm-gateway.ts, never a direct llm-client import), e.g. `<ndx home>/validation-slot/`. Keep the on-disk protocol small and documented in the module header, because PR 3 reimplements it in scripts/lib/ for the test runner and a root test will check that the two agree:\n- acquire is atomic (exclusive create or mkdir), and the holder record names its pid, the pid's process group or child pid once one is launched, start time, project directory and a token;\n- release removes only the holder's own record;\n- stale recovery: a record whose holder pid is dead AND whose recorded child/process group is gone is reclaimed; a dead holder whose test child is still alive is not, so a crash cannot admit a second validation while the old tests still run (reuse the PID-liveness approach in process/limiter.ts);\n- waiting polls with a bounded interval, reports who holds the slot (pid, project directory, since when) once and then periodically, and stops on abort (an AbortSignal for Ctrl-C and the run's overall deadline);\n- re-entrancy: `acquire` returns the token, the caller exports it to children as `NDX_VALIDATION_SLOT`, and an acquire that finds a token in its environment naming the live holder of the same slot directory returns immediately as nested, without taking or releasing the slot;\n- the result reports queue wait in milliseconds.\n\nCapacity is fixed at 1 for this wave.\n\nOperator notes:\n- Tests use a temp directory passed in explicitly; never the developer's real ndx home (the hench suite already loads tests/setup-ndx-home.js). Tests must not write `process.env.NDX_*`: pass an env object.\n- Cross-process exclusion needs at least one test with two real child processes contending for the slot.\n- Run the static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy, windows-hide-policy if you spawn)."
acceptanceCriteria:
  - "Two processes contending for the slot never hold it at once; the second waits and then acquires after release"
  - "A record whose holder and recorded child are both dead is reclaimed; one whose holder is dead but whose test child is alive is not"
  - "A nested acquire with a valid token for the live holder returns without taking or releasing the slot; a token for a dead holder or a different slot directory is ignored"
  - "Waiting stops promptly on abort and reports queue wait in milliseconds"
  - "The on-disk protocol is documented in the module header"
priority: "high"
run: {"maxTurns":150}
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
source: "ndx-capture"
blockedBy:
  - "3928f6b4-d0f8-4943-8185-f0c6cba12ddb"
---
