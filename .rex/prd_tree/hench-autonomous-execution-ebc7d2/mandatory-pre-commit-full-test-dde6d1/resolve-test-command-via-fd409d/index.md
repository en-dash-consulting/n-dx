---
id: "fd409d4d-381c-4f55-afaa-220d4bc74f11"
level: "task"
title: "Resolve test command via project config with interactive prompt fallback for unknown or inaccessible suites"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "config"
  - "ux"
source: "smart-add"
startedAt: "2026-04-30T15:52:10.503Z"
completedAt: "2026-04-30T16:08:34.119Z"
endedAt: "2026-04-30T16:08:34.119Z"
resolutionType: "code-change"
resolutionDetail: "Implemented test command resolution with config precedence chain and interactive prompt fallback. Added fullTestCommand field to HenchConfig schema. Created resolveTestCommand module with config loading, auto-detection from package.json, and interactive prompting with persistence. Integrated into finalizeRun lifecycle. Added comprehensive unit tests and documented dynamic import. All acceptance criteria met."
acceptanceCriteria:
  - "Config schema supports a fullTestCommand field in .hench/config.json with documented precedence rules"
  - "Auto-detection falls back to package.json test scripts when the config field is absent"
  - "When no command is resolvable or execution fails with permission/access errors, an interactive prompt is shown explaining the full-suite requirement and offering: supply command, opt out via flag, or abort"
  - "User-supplied command can be persisted to .hench/config.json with confirmation"
  - "In --auto/--loop mode without a resolvable command, the run aborts with a clear error pointing to the prompt or opt-out flag (no silent skip)"
  - "Unit tests cover config precedence, auto-detection, and prompt-fallback paths"
description: "Implement a resolution chain for the full-suite test command: read from .hench/config.json (new field) or .n-dx.json, fall back to detected scripts in package.json (test, test:all), and finally prompt the user when no command can be resolved or when execution access is denied. The prompt must clearly state that the gate needs to ensure the entire test suite passes, accept a user-supplied command, and surface the opt-out flag as an alternative. Resolved commands should be persisted to project config on user confirmation so the prompt does not repeat."
---

# Resolve test command via project config with interactive prompt fallback for unknown or inaccessible suites

🟠 [completed]

## Summary

Implement a resolution chain for the full-suite test command: read from .hench/config.json (new field) or .n-dx.json, fall back to detected scripts in package.json (test, test:all), and finally prompt the user when no command can be resolved or when execution access is denied. The prompt must clearly state that the gate needs to ensure the entire test suite passes, accept a user-supplied command, and surface the opt-out flag as an alternative. Resolved commands should be persisted to project config on user confirmation so the prompt does not repeat.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, config, ux
- **Level:** task
- **Started:** 2026-04-30T15:52:10.503Z
- **Completed:** 2026-04-30T16:08:34.119Z
- **Duration:** 16m
