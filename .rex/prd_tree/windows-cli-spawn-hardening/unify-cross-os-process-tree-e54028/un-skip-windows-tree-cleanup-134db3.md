---
id: "134db348-9786-4723-9d68-501931faa499"
level: "task"
title: "Un-skip Windows tree-cleanup e2e tests with a grandchild assertion (TDD red step)"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "process-lifecycle"
  - "testing"
  - "tdd"
  - "core"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "The 3 previously-skipped cases execute on Windows (no longer reported as skipped)"
  - "An assertion identifies surviving grandchild PIDs without relying on process groups (tasklist or process.kill(pid, 0))"
  - "The assertion accounts for the intermediate cmd.exe wrapper process in the Windows spawn recipe"
  - "The tests fail on current main on Windows, demonstrating the grandchild leak — and that failure is visible in CI rather than silently skipped"
  - "POSIX behavior of all 3 cases is unchanged and still green"
  - "No assertion was weakened to achieve a green run"
description: "tests/e2e/cli-orphan-cleanup.test.js (\"reaps grandchild processes after SIGINT interruption within 5 seconds\") and tests/e2e/cli-ci-child-cleanup.test.js (\"terminates the ci subprocess after a successful run\", \"force-kills the ci subprocess after SIGINT interruption\") are ALL SKIPPED on Windows — verified: 3 skipped, 0 run. Windows tree-cleanup therefore has zero CI coverage, which is why the grandchild leak went unnoticed.\n\nThis is the TDD red step for the sibling `terminateTree` task and must land FIRST. Establish the failing assertion that proves the leak before changing any termination code — otherwise the implementation swaps a known-incomplete behavior for an unverified one.\n\nWork: find the skip guard in each file (platform conditional / `it.skip` / early return) and enable the Windows path. Because `detached: true` is omitted on win32 (cli.js SPAWN_DETACHED) there is no process group to signal, so the assertion must identify survivors by PID rather than by pgid — e.g. spawn a known grandchild, capture its PID, send SIGINT to the ndx parent, then poll for liveness with `tasklist /FI \"PID eq <pid>\"` or `process.kill(pid, 0)`.\n\nEXPECTED OUTCOME: these tests FAIL on Windows when first un-skipped. That failure is the deliverable — it documents the leak. Land them red-and-quarantined (or gated behind an explicit `describe.todo`/allowlist that CI reports rather than hides) so the sibling implementation task has a target to turn green. Do NOT weaken the assertion to make it pass.\n\nWatch for Windows-specific flake sources the POSIX versions never hit: cmd.exe wrapper processes inserted by the spawn recipe sit between ndx and the real grandchild, so the process tree is one level deeper than on POSIX; PID reuse over a 5s poll window; and `taskkill`/`tasklist` output being localized on non-English Windows."
---
