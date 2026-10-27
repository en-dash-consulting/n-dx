---
id: "3b422b8a-8112-461f-b727-b1036b2777ee"
type: "change"
title: "Add distinct full-test-suite gate step to hench run lifecycle before commit"
slug: "add-distinct-full-test-suite-gate-step"
intent: "Insert a dedicated, named lifecycle step between task work completion and the commit phase that runs the entire project test suite. The step must be visible in CLI output as its own stage (separate from any task-scoped checks), block the commit on any failure regardless of whether the failure is related to the current task's changes, and surface a clear pass/fail summary. Failures must halt the run before staging/committing and present the user with rerun, skip-with-flag, and abort options consistent with existing rollback prompt UX."
acceptanceCriteria:
  - "A distinct stage labeled as the full-suite test gate appears in hench run output between work completion and commit"
  - "Commit is blocked when any test in the full suite fails, even if the failure is unrelated to the task's changed files"
  - "Gate failure surfaces a structured summary (command run, exit code, failing test count) and offers rerun/abort/skip-via-flag options"
  - "Gate runs unconditionally unless the documented opt-out flag is present"
  - "Integration test verifies that an unrelated pre-existing failing test blocks the commit on a hench run"
amends: [{"target":"dde6d1c4-a1bd-4dfe-9af8-0ec057addf16","delta":"modified","summary":"Add distinct full-test-suite gate step to hench run lifecycle before commit","base":"24876a0fc3f4eb4d0f9b39344ee9d97d38a5b4e5ac71cabc2310937f7b09afab"}]
priority: "critical"
tags:
  - "hench"
  - "testing"
  - "commit-gate"
source: "smart-add"
---
