---
id: "4b090e30-2142-4219-b274-fd8ba3a56b7e"
type: "task"
title: "Record the validation child in the host slot so a crashed holder cannot admit an overlapping run"
slug: "record-the-validation-child-in-the"
description: "PR 2 (#1034) review finding P1, must fix (comment 4556322031 on packages/hench/src/process/validation-run.ts:96).\n\nProblem: the validation wrapper only passes an environment transformer to the command; nothing calls `lease.recordChild`, and none of the gate, post-task or completion execution paths records the spawned pid. The reviewer reproduced it with a real `runTestGate` command: `holder.json` had `child: null` while the test process ran; after SIGKILL of only the hench holder, a second acquire succeeded while the first test process was still alive. The detached test tree survives its parent, so an OOM-killed or crashed holder admits overlapping validations exactly when the host is under pressure. A nested `run-all-tests.mjs` cannot repair it, because a nested lease's `recordChild` is a no-op.\n\nFix:\n- Expose the spawned child to the slot wrapper. llm-client's `exec` (packages/llm-client/src/exec.ts) already detaches the child into its own process group on POSIX (its pid is the group id); hench reaches it through `execRepoShellCmd` (packages/hench/src/guard/sandbox.ts) and llm-gateway. Add an optional on-spawn callback (or equivalent) through that path, used by `process/validation-run.ts`, that calls `lease.recordChild({ pid, group: true })` (group false on Windows) as soon as the child exists, before any test runs.\n- Cover all three managed paths: `runTestGate` (each attempt and re-run), `runPostTaskTests` and the completion check's test run.\n- Keep the callback optional so every other exec caller is unchanged; no new import from llm-client outside the gateway.\n\nTests: a cross-process test that starts a managed validation whose child keeps running, SIGKILLs only the holder process, and asserts that a second acquire waits (the record is not stale) until the child exits, then succeeds. Plus a unit test that `holder.json` names the child while a managed command runs.\n\nOperator notes:\n- Tests use an explicit temp slot directory; never the real ndx home. No `process.env.NDX_*` writes in tests.\n- This branch is PR 2 of a stack; PR 3 (#1035) reimplements the protocol in scripts/lib/validation-slot.mjs and is updated separately.\n- Run the static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy, windows-hide-policy)."
acceptanceCriteria:
  - "While a managed gate, post-task or completion test command runs with hostSlot on, holder.json records its child (process group on POSIX)"
  - "After SIGKILL of only the holding hench process while its validation child is still running, a second acquire waits until that child exits instead of reclaiming the slot; a cross-process test covers it"
  - "exec callers that do not pass the new callback behave exactly as before"
priority: "critical"
run: {"maxTurns":150}
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "review-fix"
source: "pr-review"
---
