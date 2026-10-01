---
id: "c2b544b2-65d0-4714-8cf2-02b797d11a74"
level: "task"
title: "Test forked spawns against the real orientation prompt for the lift and the cold retry"
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
  - "A test forks a parent built from the real orientation prompt builders (with and without a primer) and asserts that the forked spawn's prompt contains the lift constant"
  - "A test asserts that a scripted no-edit forked attempt is followed by exactly one cold spawn, with the cache entry kept and the retry budget not charged"
  - "A test asserts that a forked no-diff attempt with an Edit call is not retried cold"
  - "The new tests fail against main without the fix tasks applied"
description: "Add regression tests for #473, using the existing fork tests (packages/hench/tests/unit/agent/fork-spawn-wiring.test.ts, orientation.test.ts, retry-resume.test.ts) and the scripted CLI helper (packages/hench/tests/helpers/scripted-claude-cli.ts).\n\n1. Lift test: build a parent from the real `buildOrientationSystemPrompt()` and `buildOrientationPrompt()`, once with a primer and once without. Drive a forked task spawn through the cli-loop wiring, not just `buildSpawnConfig`, and assert that the stdin prompt for the `--resume … --fork-session` spawn contains the exported lift constant. Assert too that a cold spawn's prompt does not.\n2. Retry test: script a forked attempt that ends with no diff and no file-edit tool calls. Assert that the next spawn is cold (no `--resume`/`--fork-session`), that the run records the read-only refusal, that retry budget is unchanged, and that the session cache entry still exists.\n3. Negative test: a forked no-diff attempt that did make an Edit call must not trigger the cold retry.\n\nTests must fail on main without the two fix tasks."
lastModified: "2026-10-01T21:03:51.244Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
