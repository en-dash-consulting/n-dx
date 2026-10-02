---
id: "55395ac6-760f-4188-91a8-178a656fbd5b"
level: "task"
title: "Make the analyze stop tests pass on Windows, where SIGTERM terminates without running handlers"
status: "completed"
priority: "high"
tags:
  - "live"
  - "ci"
  - "windows"
source: "CI CLI Smoke (Windows) on PR #496, 2026-10-02"
startedAt: "2026-10-02T02:02:13.545Z"
completedAt: "2026-10-02T02:07:18.989Z"
endedAt: "2026-10-02T02:07:18.989Z"
acceptanceCriteria:
  - "Both tests pass on Windows and keep their current assertions on macOS and Linux."
  - "The SIGTERM e2e test is skipped on win32 with a comment explaining that Windows terminates the process without running signal handlers."
  - "No other test added on this branch asserts POSIX-only signal or exit-code semantics without a win32 branch (checked and listed in the run summary)."
  - "Changeset not required for test-only changes; if product code is touched, a patch changeset for that package."
description: "CI's CLI Smoke (Windows) job (run 36951382250 on PR #496, head 98502b67) fails two tests that assume POSIX signal semantics. The product behaves correctly on Windows; the tests need platform-aware assertions.\n\n1. `packages/sourcevision/tests/e2e/cli-analyze.test.ts` › \"records a SIGTERM as a stop: progress failed, manifest phase in error, exit 143\" — expected { code: 143, signal: null }, got { code: null, signal: 'SIGTERM' }. On Windows `child.kill('SIGTERM')` terminates the process outright (TerminateProcess); no signal handler runs, so `installStopHandlers` cannot record \"Stopped (SIGTERM)\" or exit 143. Skip this test on win32 (`it.skipIf(process.platform === \"win32\")`) with a comment saying why, and add a Windows-only assertion elsewhere if cheap: after the child is killed, `readAnalyzeProgress` reports the left-behind `running` file as `interrupted` (its pid is dead).\n\n2. `packages/web/tests/integration/live-analyze-route.test.ts` › \"signals the process the progress file names when its command line is an analyze\" — expected 'SIGTERM', got null. On win32 `signalRecordedPid` (`packages/web/src/server/routes-live-analyze.ts`) deliberately signals by pid alone because the command line cannot be read, and the response is 200 and the process ends, but Windows reports an externally terminated process as exit with `signal: null` and a non-zero code. Keep `expect(res.status).toBe(200)`; on POSIX keep `expect(signal).toBe('SIGTERM')`; on win32 assert the child exited (exit event fired, code non-zero or signal set).\n\nBefore finishing, grep both packages' tests for other assertions on `signal` / `signalCode` / exit code 143 / `'SIGTERM'` that were added on this branch (`git diff origin/main --name-only -- '*test*'`) and make the same platform split where they would fail on Windows. Do not change product code. Run git commands bare from the project root (no `cd …&&`, no `git -C`)."
lastModified: "2026-10-02T02:07:19.375Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
