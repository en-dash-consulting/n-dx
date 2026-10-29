---
id: "2e7bc6ea-ea4a-4978-b4fe-ea659bdffc55"
type: "change"
title: "The shell-test env fallback discards the user's own guard.env deny entries"
slug: "the-shell-test-env-fallback-discards"
intent: "Out-of-scope finding from the adversarial review of task 755f5f63 (run 024d3211), low severity, verdict out-of-scope (the code predates that task and was not changed by it).\n\nFailure scenario: packages/core/config.js `loadShellTestEnv` (~line 2850). When `compileEnvPolicy(loadProjectEnvPolicy(dir))` throws (for example a repository `.hench/config.json` with `guard.env.allow: 7` or `deny: [1]`), the fallback returns `sanitizeChildEnv(process.env, compileEnvPolicy(undefined))`, which applies only the defaults. The deny entries the user put in `.n-dx.local.json` (`hench.guard.env.deny`) are dropped. That environment reaches the cross-vendor pair reviewer's fallback shell test command (pair-programming.js runShellTestCommand) and `ndx ci`'s `pnpm docs:build` (ci.js ~line 143). A repository can therefore ship a malformed field and have a variable the user explicitly denied reach a repository-owned command.\n\nReachable: `ndx work` with pair review falling back to shell-test-only, and `ndx ci .`.\n\nFix (recommended): keep the compile check for `policyError`, but return `repoCommandEnv(dir, { trust: options.trust })` in the catch. It never throws, drops only the malformed field, and keeps every valid deny list (repoEnvPolicy). Update the two callers' \"the default environment filter\" wording to say the malformed field was ignored. Cost: a few lines plus two message strings; risk: none (repoCommandEnv is already the non-error path). This matches the fix task 755f5f63 made for loadVendorCheckEnv."
acceptanceCriteria:
  - "With a repository hench.guard.env.allow of 7 and a user .n-dx.local.json hench.guard.env.deny naming a placeholder variable, loadShellTestEnv's env lacks that variable and policyError is set"
  - "The pair reviewer's fallback shell test command and ndx ci's docs build do not receive a variable the user denies when the repository's guard.env is malformed"
  - "The callers' warnings no longer say the default environment filter applied"
  - "A test covering the scenario fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"755f5f63-86fc-473e-b46e-cdd654ec894a","run":"024d3211-17f3-4544-8c81-e54d92e2fa32"}
tags:
  - "security"
  - "ndx-adversarial-review"
  - "severity:low"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
