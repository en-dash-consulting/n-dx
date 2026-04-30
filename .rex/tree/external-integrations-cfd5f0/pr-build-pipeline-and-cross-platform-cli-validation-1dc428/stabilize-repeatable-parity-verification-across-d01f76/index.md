---
id: "d01f7636-0eff-4d7c-b827-736bd7e1039d"
level: "task"
title: "Stabilize repeatable parity verification across original macOS and Windows CI steps"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "pipeline"
  - "parity"
  - "stability"
  - "cross-platform"
source: "smart-add"
startedAt: "2026-04-07T20:02:13.961Z"
completedAt: "2026-04-07T20:06:31.646Z"
acceptanceCriteria:
  - "The macOS and Windows CI jobs execute the same documented CLI smoke parity sequence and produce comparable output artifacts"
  - "Parity validation checks that the current responses match the established baseline/original expected steps for both OS jobs"
  - "At least one automated test or fixture-based validation covers repeat runs of the parity workflow and confirms stable output shape across executions"
  - "The CI pipeline completes successfully when outputs are equivalent and surfaces a clear diff when platform responses diverge"
description: "Make the two OS smoke-check heads deterministic and repeatable by ensuring they execute the same canonical `ndx` validation steps, compare against the expected baseline behavior, and fail only on real parity regressions rather than runner-specific instability."
---

# Stabilize repeatable parity verification across original macOS and Windows CI steps

🔴 [completed]

## Summary

Make the two OS smoke-check heads deterministic and repeatable by ensuring they execute the same canonical `ndx` validation steps, compare against the expected baseline behavior, and fail only on real parity regressions rather than runner-specific instability.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** ci, pipeline, parity, stability, cross-platform
- **Level:** task
- **Started:** 2026-04-07T20:02:13.961Z
- **Completed:** 2026-04-07T20:06:31.646Z
- **Duration:** 4m
