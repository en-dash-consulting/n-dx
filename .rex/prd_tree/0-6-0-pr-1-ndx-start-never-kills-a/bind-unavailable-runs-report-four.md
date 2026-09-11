---
id: "e40e04aa-30e7-48c3-8d65-37e0ba3bb89e"
level: "task"
title: "Bind-unavailable runs report four passing no-op tests in cli-start-two-projects"
status: "completed"
priority: "low"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-01-followup"
  - "fixed-in-pr-02"
source: "code review of PR #359, 2026-09-11"
startedAt: "2026-09-11T13:01:49.354Z"
completedAt: "2026-09-11T13:07:06.079Z"
endedAt: "2026-09-11T13:07:06.079Z"
acceptanceCriteria:
  - "On a host that cannot bind loopback, the four tests report as SKIPPED, not passed."
  - "On a normal host every test still runs and asserts exactly as today (no behaviour change to the passing path)."
  - "The chosen spelling matches the ctx.skip() pattern already used in tests/unit/web-port-occupant.test.js."
description: "Severity: low. Found by review of PR 1 (commit c8dde765). Fixed on the PR-2 branch.\n\nFAILURE SCENARIO\nIn tests/e2e/cli-start-two-projects.test.js, beforeAll detects a host that cannot bind loopback (EPERM from server.listen) and sets `canBindPorts = false`. Each of the four `it` bodies then opens with `if (!canBindPorts) return;`. Returning from a test body is a PASS in vitest, so on such a host the file reports \"4 passed\" having asserted nothing about peer detection, and CI output is indistinguishable from a real pass.\n\nThe sibling unit test added in the same epic already does this correctly: tests/unit/web-port-occupant.test.js's listenerPidsOnPort case takes `ctx` and calls `ctx.skip()` when the platform query is unavailable, so the run reports a skip. That is the pattern to copy.\n\nNote this is belt-and-braces territory — scripts/run-vitest-bind-aware.mjs already excludes this file from the root profile when binding is unavailable, so the early return fires only if that exclusion is bypassed or the detection disagrees. It is still worth fixing: a green line that asserted nothing is a false signal, and the correct spelling costs one character more.\n\nSOLUTION\nEither take `ctx` in each test and call `ctx.skip()` in place of the bare return, or hoist the condition into `describe.skipIf(...)` / `it.skipIf(...)` so vitest reports skipped rather than passed."
lastModified: "2026-09-11T13:07:06.086Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
