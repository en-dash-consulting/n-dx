---
id: "de29498f-6556-4355-b68b-d5c4b3c11129"
type: "task"
title: "Make the host slot tests hold on Windows"
slug: "make-the-host-slot-tests-hold-on-windows"
summary: "Three of the new slot tests fail on Windows in CI. They assume Unix behaviour for killed processes and for blocking a directory, so they test something Windows doesn't do. This makes them check what Windows actually does, so CI stays green there."
description: "PR 2 (#1034) CI, Tests (Windows, hench+web), run 43519343995 (same three failures on #1035's Windows job). Linux and macOS pass these tests.\n\n1. `packages/hench/tests/e2e/validation-slot-crash.test.ts` > \"stays held while the validation child runs, and frees once it exits\" fails at line 115 (`expect(acquired).toBe(false)` got true): after the holder is SIGKILLed, a second acquire succeeds at once.\n   Likely cause, to confirm from the code: on Windows `treeKillSpawnOptions` (`packages/llm-client/src/process-tree.ts`) does not detach, and libuv puts a non-detached child in a job object with KILL_ON_JOB_CLOSE. So killing the holder also kills its validation child, the recorded child (`group: false` on win32, as the test already asserts) is dead, and reclaiming is the correct behaviour there.\n   - Fix the test to expect each platform's real behaviour, not to skip it silently:\n     - On win32 assert the slot frees once the holder is killed. The child dies with it.\n     - Keep the current assertions elsewhere.\n   - Add one sentence to the slot module header (`packages/hench/src/process/validation-slot.ts`, rule 4 on recorded children), and the same to `scripts/lib/validation-slot.mjs` if PR 3's copy exists on this branch (it does not on PR 2; skip if absent), saying that on Windows a holder's non-detached children end with it.\n   - If the code shows the child does NOT die with the holder on Windows, then the slot is wrongly reclaimed while a child runs. Stop and report rather than changing the test.\n\n2. `packages/hench/tests/integration/test-gate.test.ts`, describe \"validation commands inside the host slot\":\n   - \"keeps the command's result when the slot cannot be released, and warns\" (line ~435: `expected [] to have a length of 1`). The command replaces the slot directory with a file so release fails with ENOTDIR. On Windows no warning is produced, probably because the replacement fails or release sees another error code.\n   - \"reclaims a record it could not release on its next validation instead of waiting on itself\" (line ~456: `warnings[0]` undefined). It uses `chmodSync(slotDir, 0o555)`, which does not stop deletion on Windows.\n\n   Make each produce a release failure on Windows too, if that can be done reliably (for example a directory handle or a file with the read-only attribute where Windows honours it). Otherwise mark them `skipIf(process.platform === \"win32\")` next to the existing `getuid() === 0` skip, with a comment naming why. Either way, check that production release handling covers the Windows error codes it can actually get, and say what you found.\n\nOperator notes: you are on macOS and cannot run Windows. Reason from the code and libuv/Node documentation; state in the summary what is confirmed and what is inferred. Run the changed test files locally. Run the static root policy tests. No changeset unless production code changes (then a patch changeset for `@n-dx/hench`). No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "The crash test asserts the platform's real behaviour: on win32 the slot frees once the holder is killed, elsewhere it stays held while the child runs"
  - "The two release-failure tests either produce a release failure on Windows or are skipped there with a stated reason"
  - "The slot module header says what happens to a holder's children on Windows"
  - "Changed test files pass locally; static root policy tests pass"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "ci-fix"
  - "windows"
source: "ndx-capture"
---
