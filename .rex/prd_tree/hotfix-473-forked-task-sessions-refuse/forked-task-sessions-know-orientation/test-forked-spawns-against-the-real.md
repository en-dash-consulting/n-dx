---
id: "c2b544b2-65d0-4714-8cf2-02b797d11a74"
level: "task"
title: "Test that a forked spawn built from the real orientation prompt carries the lift"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "session-fork"
  - "test"
blockedBy:
  - "54bbe6b8-9d8a-4539-b185-3d30b352c921"
  - "a7f79d0d-4d63-42db-8e5e-e77c979990b8"
source: "ndx-capture"
acceptanceCriteria:
  - "An integration test runs cliLoop with a cached warm parent and asserts that the stdin prompt of the --resume \u2026 --fork-session spawn begins with ORIENTATION_LIFT_NOTICE"
  - "The orientation spawn in that test is built from the real buildOrientationSystemPrompt() and buildOrientationPrompt(), once with a fresh sourcevision primer and once without, and both cases get the lift"
  - "The same test asserts that a cold spawn (sessionStrategy cold, or no usable parent) and a retry-resume of the forked session do not get the lift"
  - "With only the lift injection in cli-loop.ts reverted (the forkingWarmParent prefix and the baseEnvelope bypass from 8accdd5fc), the new test fails; this check is reported in the run summary and the revert is not committed"
  - "No test already added by 8accdd5fc or 275ceb687 is duplicated"
description: "Regression test for the #473 lift. Narrowed after tasks 54bbe6b8 and a7f79d0d landed: the cold-retry behaviour (one cold re-spawn, no retry budget used, cache kept, edit-tool and cold no-diff negatives) is already covered by packages/hench/tests/integration/read-only-refusal-retry.test.ts and tests/unit/agent/read-only-refusal.test.ts. Do not re-test it.\n\nWhat is not yet covered: tests/unit/agent/orientation.test.ts only checks the ORIENTATION_LIFT_NOTICE constant and the reworded builders. Nothing proves that cliLoop actually puts the lift into a forked spawn's first user turn. That wiring is the fix (cli-loop.ts, `forkingWarmParent` and the `baseEnvelope` bypass).\n\nApproach: copy the setup of read-only-refusal-retry.test.ts (createScriptedClaudeCli, setupScriptedProject, `forks`/`resumes`, decodeClaudeDelivery from tests/helpers). Let ensureWarmParent run the real orientation spawn against the scripted CLI, so the parent's prompt comes from buildOrientationSystemPrompt()/buildOrientationPrompt(). Do it once with a fresh .sourcevision/PRIMER.md (readFreshPrimer must accept it) and once without. Then assert on the decoded stdin of the forked task spawn. Add the cold-spawn and retry-resume negatives to the same file. Name it packages/hench/tests/integration/fork-lift-wiring.test.ts or similar.\n\nFailing-on-main check: temporarily remove only the lift injection in cli-loop.ts, run the new test, confirm it fails, restore the file (git checkout -- packages/hench/src/agent/lifecycle/cli-loop.ts), and say in the summary that this was done. Do not use git stash. If the test changes any prompt text the prompt-census baseline would need re-recording; it should not, since this task adds tests only."
lastModified: "2026-10-01T22:45:44.000Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
