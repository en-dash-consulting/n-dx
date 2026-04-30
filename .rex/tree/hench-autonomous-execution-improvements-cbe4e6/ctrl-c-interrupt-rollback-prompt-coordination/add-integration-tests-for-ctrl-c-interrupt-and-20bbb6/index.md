---
id: "20bbb688-65c2-4331-a508-5b5700272200"
level: "task"
title: "Add integration tests for Ctrl-C interrupt and rollback prompt interaction"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "testing"
  - "signal-handling"
source: "smart-add"
startedAt: "2026-04-24T20:56:08.084Z"
completedAt: "2026-04-24T21:00:00.697Z"
resolutionType: "code-change"
resolutionDetail: "Added a 6th integration test in packages/hench/tests/integration/sigint-prompt.test.ts that explicitly asserts criterion 4 of the acceptance list (\"a second SIGINT during the prompt does not call process.exit(1) and allows the readline to complete\") using vi.spyOn(process, \"exit\") and an outer handler shaped like run.ts's force-exit branch (unconditional process.exit(1)). Confirms: exitSpy never called; outerForceExit never called; readline closed cleanly; outer handler restored exactly once. The previous 5 tests from the sibling commit already covered the other acceptance criteria (prompt presented when dirty files exist, 'y' reverts files, 'n' leaves them, TTY mocking in lieu of real TTY); the new test closes the remaining gap by pinning the no-exit guarantee with a direct process.exit spy."
acceptanceCriteria:
  - "Test confirms that after SIGINT the rollback prompt is presented when dirty files exist"
  - "Test confirms that responding 'y' causes revertChanges to be called"
  - "Test confirms that responding 'n' leaves files in place and exits without error"
  - "Test confirms that a second SIGINT during the prompt does not call process.exit(1) and allows the readline to complete"
  - "Tests run in CI without requiring a real TTY (use isTTY mocking or pipe-mode)"
description: "The interrupt-to-rollback path currently has no automated coverage. Add integration tests that simulate a SIGINT mid-run, verify the rollback prompt is displayed, and assert correct behavior for both 'confirm' and 'skip' responses. Cover the edge case where a second SIGINT arrives while the prompt is open."
---

# Add integration tests for Ctrl-C interrupt and rollback prompt interaction

🟡 [completed]

## Summary

The interrupt-to-rollback path currently has no automated coverage. Add integration tests that simulate a SIGINT mid-run, verify the rollback prompt is displayed, and assert correct behavior for both 'confirm' and 'skip' responses. Cover the edge case where a second SIGINT arrives while the prompt is open.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** hench, testing, signal-handling
- **Level:** task
- **Started:** 2026-04-24T20:56:08.084Z
- **Completed:** 2026-04-24T21:00:00.697Z
- **Duration:** 3m
