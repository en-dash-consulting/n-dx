---
id: "1a72b5c1-bc52-42f6-8918-402065d6e324"
level: "task"
title: "Add Windows pipeline stage for ndx install-and-run smoke validation"
status: "completed"
priority: "high"
tags:
  - "ci"
  - "pipeline"
  - "windows"
  - "cli"
  - "regression"
source: "smart-add"
startedAt: "2026-04-07T14:26:24.720Z"
completedAt: "2026-04-07T14:28:52.966Z"
acceptanceCriteria:
  - "Pipeline includes a distinct Windows validation stage parallel to the MacOS validation stage"
  - "The stage executes the same logical install-and-run smoke flow as MacOS, translated to Windows command syntax where required"
  - "The Windows stage captures the same set of deterministic response fields and exit codes as the MacOS stage"
  - "The stage excludes assertions on generated code, model-generated prose, and any nondeterministic text output"
  - "A mismatch against expected static responses or exit codes causes the Windows stage to fail with platform-specific diagnostics"
description: "Introduce a second CI stage that starts the requested Windows-based container environment, runs the same install and smoke-command workflow using Windows-native commands, and captures deterministic outputs and exit codes using the same assertion scope as the MacOS stage."
---

# Add Windows pipeline stage for ndx install-and-run smoke validation

🟠 [completed]

## Summary

Introduce a second CI stage that starts the requested Windows-based container environment, runs the same install and smoke-command workflow using Windows-native commands, and captures deterministic outputs and exit codes using the same assertion scope as the MacOS stage.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** ci, pipeline, windows, cli, regression
- **Level:** task
- **Started:** 2026-04-07T14:26:24.720Z
- **Completed:** 2026-04-07T14:28:52.966Z
- **Duration:** 2m
