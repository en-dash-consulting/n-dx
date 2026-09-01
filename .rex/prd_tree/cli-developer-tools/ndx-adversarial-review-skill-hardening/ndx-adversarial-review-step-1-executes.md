---
id: "9c9ea0ac-94f1-4f57-8cd1-64cf248fcdb2"
level: "task"
title: "/ndx-adversarial-review Step 1 executes the test suite via verify_criteria's default runTests: true"
status: "completed"
priority: "medium"
tags:
  - "skills"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-08-21T14:05:14.248Z"
completedAt: "2026-08-21T14:07:53.370Z"
endedAt: "2026-08-21T14:07:53.370Z"
resolutionType: "code-change"
resolutionDetail: "Claim mode passes runTests: false so verify_criteria maps criteria without spawning the project's test command; Step 2 declares its discovered commands the only ones permitted to execute tests. AC3 verified by auditing every command Step 1 can issue. Full root e2e green (1238 passed)."
acceptanceCriteria:
  - "Step 1's claim-mode `verify_criteria` call passes `runTests: false`"
  - "The skill states explicitly that Step 2's discovered command is the only thing permitted to execute tests"
  - "No instruction earlier than Step 2 can spawn a project command"
description: "**Severity:** medium — **Verdict:** should-fix\n\n**Failure scenario.** In a project whose `.rex/config.json` sets a `test` command, claim mode calls `verify_criteria` with no `runTests` argument. `packages/rex/src/cli/mcp.ts:210` and `handleVerifyCriteria` (`packages/rex/src/cli/mcp-tools.ts:493`) both default it to `true`, so `packages/rex/src/core/verify.ts:281` spawns the configured test command. This happens in Step 1 — before Step 2 has discovered anything about the project's tooling, using a command the skill never vetted, while the skill header promises \"by itself, this skill changes nothing\" and Step 5 asserts \"nothing has been written at this point.\"\n\nThe skill spends an entire section teaching the assistant to discover commands before running them and to run only read-only checks, then bypasses that apparatus one step earlier.\n\n**Evidence.** `packages/core/assistant-assets/skills/ndx-adversarial-review.md` — Step 1, claim-mode paragraph.\n\n**Reachability.** Any consumer project that sets `test` in `.rex/config.json`. NOT reachable in the n-dx repo itself, whose `.rex/config.json` has no `test` key — `verify.ts:281` gates on `testCommand` being set. It ships broken rather than failing here.\n\n**Possible solutions.**\n1. *Recommended.* Pass `runTests: false` in the Step 1 call, so `verify_criteria` only maps acceptance criteria to test files, and Step 2's discovered command remains the sole executor of tests. Two words; preserves the criteria-mapping value that motivated the call.\n2. Move the `verify_criteria` call into Step 2 after discovery and allow `runTests: true`. More faithful to actually verifying criteria, but re-introduces execution of a command the skill did not discover, which is the thing Step 2 exists to prevent."
---
