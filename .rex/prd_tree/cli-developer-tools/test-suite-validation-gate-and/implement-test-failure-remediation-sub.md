---
id: "35803d82-ef26-418f-ac27-0b28b33217a9"
level: "task"
title: "Implement test-failure remediation sub-loop in self-heal"
status: "completed"
priority: "critical"
tags:
  - "self-heal"
  - "testing"
  - "remediation"
  - "hench"
source: "smart-add"
startedAt: "2026-04-14T19:25:20.523Z"
completedAt: "2026-04-14T19:29:51.094Z"
acceptanceCriteria:
  - "Parses vitest failure output to extract the production file path and error message implicated in each failure"
  - "Constructs a hench brief scoped to the failing production file and specific error"
  - "Blocks hench fix attempts from writing to any file under tests/, *.test.ts, or *.spec.ts — throws on violation"
  - "Re-runs only the affected package's test suite after each fix attempt (not the full monorepo suite) for speed"
  - "Exits the sub-loop and marks self-heal run as failed with a structured summary if max iterations is reached without a green gate"
  - "Max iterations is configurable via selfHeal.testRemediationMaxIterations in .n-dx.json (default: 3)"
  - "Each fix attempt, its outcome, and the re-run result are appended to the run artifact"
description: "When the test gate detects failures, initiate a bounded remediation sub-loop: parse vitest failure output to identify the failing production file (not the test file), construct a focused hench brief scoped to that file and error message, execute a fix attempt restricted to production code only, and re-run only the affected package's tests. The loop repeats up to a configurable max-iterations limit before surfacing a human-readable failure report. Test files are never in scope for modification."
---
