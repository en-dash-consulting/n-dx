---
id: "a4ee4cda-49d7-4ea3-8df5-f3953da19093"
type: "task"
title: "API-provider runs keep waiting for the validation slot after the first Ctrl-C"
slug: "api-provider-runs-keep-waiting-for-the"
summary: "On runs that talk to the model directly rather than through a CLI, pressing Ctrl-C once does not stop a test run that is queued behind another worktree; it takes a second press. The CLI path already stops on the first."
description: "Verdict: should-fix (adversarial review of adb92a12, run d47c99c0). Severity medium.\n\nScenario: provider=api (agent/lifecycle/loop.ts) with hench.testGate.hostSlot on, while another worktree holds the slot. The operator presses Ctrl-C while the gate, post-task tests or the completion check is queued. run.ts aborts its interrupt signal on the first SIGINT (a second exits), but agentLoop receives no abortSignal and loop.ts's finalizeRun calls and validationSlotFromConfig calls pass no signal, so the wait keeps polling until the holder releases or a second Ctrl-C exits the process. The acceptance criterion \"waiting still ends on Ctrl-C\" holds for the CLI loop (cli-loop.ts passes opts.abortSignal, including the gate-only retry) but not here.\n\nReachability: `ndx work` with provider api and hostSlot on, under contention.\n\nOptions:\n- (A, recommended) Thread run.ts's abortSignal into agentLoop (AgentLoopOptions.abortSignal), pass it to the three finalizeRun calls and to validationSlotFromConfig in loop.ts. Cost: small plumbing plus a test. Risk: low.\n- (B) Leave the double Ctrl-C as the documented stop for API runs. Cheaper; the criterion stays unmet."
acceptanceCriteria:
  - "agentLoop accepts the run's abort signal and passes it to finalizeRun and to the completion check's validation slot options"
  - "A test shows an API-loop gate queued behind another holder ends when the run's signal aborts, without a second interrupt"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
  - "pr-2-host-slot"
source: "ndx-adversarial-review"
---
