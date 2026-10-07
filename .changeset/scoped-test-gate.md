---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Cut the test time of an `ndx work` run (#539).

- **Gate-only retry.** When a task's last run failed only at the test gate, with its work committed and its completion held, `ndx work --task=<id>` skips the agent, re-runs the gate and applies the held completion on green. A review that passed on the same commit is inherited. A second gate failure goes back to the agent. The read-only refusal also stands down when earlier attempts already committed the task's files, instead of re-spawning the agent cold.
- **Flake absorption.** With `hench.testGate.rerunCommand`, an unattended run re-runs only the failed suites once; a pass counts and is recorded as `testGate.flakyRerun`.
- **Scoped gate.** `hench.testGate.command` replaces the gate command and takes `{base}`, the run's start commit. `scripts/run-all-tests.mjs` gains suite labels, `affected <base>` and `--list`. Run records gain `testGate.base`, `suites`, `scopeFallback`, `firstAttempt`, `rerun` and `gateOnlyRetry`. Both keys are opt-in and appear in `ndx config` help and the dashboard config fields.
- **Scoped checks.** The agent brief and the in-hench reviewer run scoped checks only, since the gate follows and CI runs everything.
- **Interactive gate prompt.** A failed gate on an interactive run offers rerun/abort/skip again; it used to abort silently.
