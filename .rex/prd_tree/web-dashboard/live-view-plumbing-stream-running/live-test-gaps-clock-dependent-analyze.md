---
id: "19bf707b-8161-406f-be00-c6aaf3ae4e70"
level: "task"
title: "Live test gaps: clock-dependent analyze route fixture, untested stop handlers and log-stream fallback, unregistered LiveSources seam"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "live-analyze-route.test.ts passes with the system clock set before 2026-10-01 (no fixed STARTED date)."
  - "A test SIGTERMs a running analyze and asserts the progress file and manifest record the stop."
  - "A test injects a log stream error and asserts the run log is still written at run end."
  - ".claude/rules/web-injection-seams.md lists the LiveSources seam."
description: "Four gaps found in the end-of-branch review, each cheap:\n1. `packages/web/tests/integration/live-analyze-route.test.ts:28` fixes STARTED at 2026-10-01T00:00Z and compares it with real file mtimes, so it fails on any clock before that date. Use `new Date(Date.now() - 60_000).toISOString()` or set mtimes with `utimesSync`.\n2. Nothing tests sourcevision's `installStopHandlers` (SIGTERM → \"Stopped (SIGTERM)\", manifest phase error, exit code 143); the viewer's stopped state depends on that string. Add a small e2e that spawns `analyze --fast` on the fixture and SIGTERMs it.\n3. The end-of-run fallback in hench `endRunLog` (when the stream's close reports an error, `persistRunLog` rewrites the file) is untested; deleting it leaves every test green. Inject a stream error such as ENOSPC.\n4. `LiveSources` (listWorkspaces, memoryFloorBytes) is a new callback injection from `packages/web/src/server/start.ts:719-722` into routes-live and routes-live-analyze, but `.claude/rules/web-injection-seams.md` has no row for it.\n\nVerdict: should-fix (severity low)."
lastModified: "2026-10-01T15:23:26.155Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
