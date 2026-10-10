---
id: "730a1e3f-cba2-43d5-b00d-84fc2b3a5875"
level: "task"
title: "The reviewer's shell-test fallback runs with a filtered environment"
status: "pending"
priority: "critical"
source: "pr-review"
acceptanceCriteria:
  - "No path spawns the reviewer's shell test command with the raw parent environment: runShellTestCommand's child gets the project's guard.env policy applied, without the reviewer vendor's authentication exceptions such as ANTHROPIC_API_KEY or OPENAI_API_KEY (test in the actual child process: a credential-shaped fixture variable is absent and an explicitly allowed one is present)"
  - "When the project policy cannot be resolved (for example hench.guard.env.deny: [42]), the fallback still runs and its child uses the default deny policy, never process.env (regression test that injects the resolution failure, gets mode shell-test-only, and verifies a credential-shaped fixture such as NDX_REVIEW_FIXTURE_SECRET is absent in the fallback child)"
  - "The default-policy fallback is visible: the result or the reviewer output names that the project's guard.env policy could not be loaded"
  - "The shell test environment is resolved in packages/core/config.js; pair-programming.js gains no import of @n-dx/llm-client (architecture-policy and domain-isolation tests pass)"
description: "P1 from Ryan's independent review scan on PR #658 (inline on packages/core/pair-programming.js, after T2). runShellTestCommand spawns the configured test command with shell: true and no env, so the child inherits the whole parent environment. T2 made an environment-resolution failure in loadVendorCliEnv resolve as spawnError, and runCrossVendorReview falls back to runShellTestCommand on spawnError, so a failure of the credential filter now bypasses it: reproduced with .n-dx.json hench.guard.env.deny: [42], an available reviewer stub and a configured test command; the result was mode shell-test-only, passed true, and the test child read a fixture NDX_REVIEW_FIXTURE_SECRET (and would read GITHUB_TOKEN / AWS_SECRET_ACCESS_KEY) from the parent. Before T2 that failure rejected before the test command ran. The same unfiltered inheritance also applies when the reviewer CLI fails to start for any other reason (pre-existing). Fix: keep T2's fallback, but every path that spawns the shell test command passes an explicitly sanitized env: the project's guard.env policy (its allow entries are how a project's tests get variables they need), with none of the reviewer vendor's authentication exceptions; if the project policy cannot be resolved, the default deny policy, never raw process.env. Resolve that env in packages/core/config.js beside loadVendorCliEnv (config.js is the spawn-exempt module that already reads guard.env and imports llm-client's compileEnvPolicy/sanitizeChildEnv); pair-programming.js must not import @n-dx/llm-client directly. Do not swallow the policy error silently: the shell-test-only result or the reviewer log should say the project policy could not be loaded and the default filter was used."
lastModified: "2026-10-10T19:25:53.723Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
