---
id: "de4630e3-3c8b-47ef-8b65-cbd7e9366f21"
level: "task"
title: "An analyze that fails after its phases is recorded as failed with no reason"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An error after the last phase is recorded in the progress file's error field (unit test)."
description: "Failure: in `packages/sourcevision/src/cli/commands/analyze.ts:500-505`, an error thrown from output generation, PR markdown generation or narration scheduling reaches `finally` and the progress file is marked failed, but `noteAnalyzeError` is never called, so a terminal run's Live page says \"This analysis failed.\" with no phase or error (or with another run's line, see the dashboard-output item).\n\nVerdict: should-fix (severity low, cheap).\n\nOptions:\n- Recommended: add `catch (err) { noteAnalyzeError(...); throw err; }` around that span in cmdAnalyze. Small, plus a test."
lastModified: "2026-10-01T15:23:22.891Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
