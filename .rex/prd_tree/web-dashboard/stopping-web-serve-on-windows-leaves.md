---
id: "352dc19d-62a9-48bb-87e9-2435fc6167fb"
level: "task"
title: "Stopping web serve on Windows leaves the ndx work and sv analyze children it spawned running"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "web"
  - "windows"
  - "process-lifecycle"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Sending SIGTERM to a running `web serve` on Windows terminates an `ndx work` child it spawned, proven by an integration test that asserts the child pid is gone within the grace period"
  - "The same holds for an sv analyze child started through POST /api/commands/sv-analyze"
  - "Fixture cleanup in packages/web/tests/e2e-ui no longer needs EBUSY retries to pass after a spec that started a child process"
description: "Severity: high. Verdict: out-of-scope for the Playwright change that exposed it (pre-existing); worth fixing because an orphaned agent keeps spending tokens and holding files after the operator believes it stopped.\n\nFAILURE SCENARIO\nThe dashboard (`web serve`, as started by `ndx start` or by the Playwright fixture) spawns `ndx work` for a Start now, which spawns the vendor CLI; or spawns `sv analyze`. The server process is then terminated with SIGTERM (fixture teardown, `ndx start stop` reclaim paths, a crash). On Windows there is no process group to signal and no job object: the server dies, the `ndx work` → `claude` tree keeps running against the project, continues to call the vendor, and holds handles in the directory. Observed 2026-10-13: fixture cleanup failed with EBUSY on `rmdir` after the server was killed while a child analysis was still running; a manual flow that timed out mid-run left the agent working in a temp directory the test was deleting; a lingering console window was reported by the operator.\n\nEVIDENCE\n- packages/web/src/server/routes-hench.ts:2204 (spawnManaged for ndx work), routes-commands.ts (sv analyze) — children are tracked for explicit stop routes, but nothing walks the tree when the server itself is terminated\n- packages/llm-client/src/process-tree.ts:567-630 and packages/core/child-lifecycle.js:372-420 — taskkill /T exists but is invoked only on the explicit stop paths, not on server shutdown signals\n- `treeKillSpawnOptions()` returns {} on win32 deliberately (no detached), so the children are in the server's libuv job object only when the server exits normally\n\nREACHABILITY: any Windows operator who stops or loses the dashboard while a run or analysis is active; the Playwright suites hit it on every mid-run failure.\n\nSOLUTIONS\n1 (recommended): on SIGTERM/SIGINT and on `process.on(\"exit\")` in start.ts, terminate every managed child through the existing tree-kill helper (taskkill /T on win32) with a bounded wait before exiting. Cost: a shutdown hook plus an integration test that spawns a child and asserts its pid is gone after the server is signalled. Risk: a long grace period delays shutdown; keep it bounded.\n2: have the Playwright fixtures terminate active runs through POST /api/hench/execute/:taskId/terminate before stopping the server (this is filed as its own task under the Playwright feature) — it protects the suites but not operators."
lastModified: "2026-10-13T19:09:04.379Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
