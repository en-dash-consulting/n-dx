---
id: "3924d96d-7d74-4569-9a03-4cc72b86a465"
level: "task"
title: "The cross-vendor reviewer degrades to the shell test command when its environment cannot be resolved"
status: "completed"
priority: "high"
source: "ndx-capture"
startedAt: "2026-10-10T18:15:01.907Z"
completedAt: "2026-10-10T18:19:00.738Z"
endedAt: "2026-10-10T18:19:00.738Z"
resolutionType: "code-change"
resolutionDetail: "resolveReviewerEnv in pair-programming.js turns a loadVendorCliEnv rejection into a spawnError result for both reviewer runners; tests in pair-programming-env-failure.test.js."
acceptanceCriteria:
  - "A config load error in loadVendorCliEnv resolves the reviewer (runReviewerLlm and runReviewerLlmCapturing) with spawnError, never rejects (test)"
  - "With a test command configured, the reviewer then runs it (test)"
description: "Finding 2 on #623. packages/core/pair-programming.js runReviewerLlm and runReviewerLlmCapturing became async and await loadVendorCliEnv(dir, …) before their try/Promise. A config or LLM-config load error now rejects; before, every failure resolved with spawnError, and the caller (the 'if (llmResult.spawnError)' branch) falls back to the shell test command on spawnError. Fix: catch the loadVendorCliEnv failure inside each function and resolve { exitCode: 1, timedOut: false, spawnError: <message> } (plus output: '' for the capturing variant)."
lastModified: "2026-10-10T18:19:01.005Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
