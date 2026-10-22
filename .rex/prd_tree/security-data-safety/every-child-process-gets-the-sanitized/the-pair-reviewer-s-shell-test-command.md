---
id: "33ed7463-3ab9-426a-960c-1e6f01ab695b"
level: "task"
title: "The pair reviewer's shell test command honours a repository-supplied guard.env.allow in an untrusted checkout"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): the pair reviewer's shell-test fallback takes its environment from repoCommandEnv, the one builder"
  - "In an untrusted checkout whose .hench/config.json has guard.env.allow naming a sentinel credential variable, runShellTestCommand's child does not see that variable (test in a real child process, asserting presence only)"
  - "Once the repository is trusted (recordRepoTrust), the same allow entry reaches the child"
  - "loadShellTestEnv delegates to llm-client repoCommandEnv; pair-programming.js gains no import of @n-dx/llm-client (architecture-policy and domain-isolation pass)"
description: "Verdict: should-fix (pre-existing, found while reviewing task fc21d703, which added llm-client `repoCommandEnv`).\n\nScenario: a cloned repository ships `.hench/config.json` with `guard.env.allow: [\"GITHUB_TOKEN\"]` (or `[\"*\"]`) and a `rex.test` command, and is never trusted. `ndx work` with pair review falls back to `runShellTestCommand` (packages/core/pair-programming.js:864), whose environment comes from `loadShellTestEnv` (packages/core/config.js:2654). That function compiles `hench.guard.env` straight from the repository config with no trust evaluation, so the repository's own test command receives the allowed credential. Every other repository-owned command (test gate, post-task tests, audit, verify_criteria) now goes through `repoCommandEnv`, which drops repository allow entries while untrusted. This is a second builder that disagrees with it.\n\nReachable: `ndx work` with `hench.review.mode: pair` when the reviewer CLI cannot start, and the shell-test-only fallback.\n\nOptions:\n1. (Recommended) `loadShellTestEnv` calls llm-client `repoCommandEnv(dir)` through config.js's existing dynamic import, and keeps the default-deny fallback and `policyError` when the call throws. This is a small change, and the existing tests in pair-programming-shell-test-env.test.js stay valid.\n2. Duplicate the trust check in config.js. Not recommended: it would be a second copy of the rule.\n\n#686 finding 3, which this follows up:\n\n> **Fix:** thread the sanitized child environment (or a single safe-environment builder) through every subprocess caller: tests, gate, audit, and rex. Add an integration test that fails if a sentinel credential is visible to the test command.\n\nCaptured during the T4 run (fc21d703); kept in layer 2 by Ryan on 2026-10-16."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T01:21:38.153Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
