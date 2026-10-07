---
id: "c7d2cf2c-9333-4a42-a0cc-201338744f93"
level: "task"
title: "Install the sv analyze stop handlers before the progress file says running"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Fixes GitHub issue #562 (read it with gh issue view 562). In packages/sourcevision/src/cli/commands/analyze.ts (cmdAnalyze, around line 428), startAnalyzeProgress writes the progress file with status running before installStopHandlers registers process.once for SIGTERM and SIGINT. A signal in that window kills the process with the default disposition, so the e2e test packages/sourcevision/tests/e2e/cli-analyze.test.ts 'records a SIGTERM as a stop: progress failed, manifest phase in error, exit 143' intermittently sees signal SIGTERM and code null instead of code 143 (seen on the macOS CI runner). Fix the ordering so the handlers exist before the progress file says running, keeping the --deep rule that only the run which owns the progress file installs handlers; the handler must tolerate a progress file that is not written yet. Update the test comment that claims the gap is safe. Acceptance criteria: (1) the stop handlers are registered before the progress file first reads running, for a run that owns the progress file; (2) a --deep sub-analysis that does not own the progress file still installs no handlers (existing tests stay green); (3) the SIGTERM e2e test passes 50 consecutive local runs; (4) the sourcevision package suite passes; (5) a patch changeset for @n-dx/sourcevision references #562."
lastModified: "2026-10-07T19:39:14.453Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
