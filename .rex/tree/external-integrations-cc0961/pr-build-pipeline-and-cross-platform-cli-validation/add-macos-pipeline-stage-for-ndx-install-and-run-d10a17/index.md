---
id: "d10a172b-4b1f-4da1-8736-ec9ae8e11b12"
level: "task"
title: "Add MacOS pipeline stage for ndx install-and-run smoke validation"
status: "completed"
priority: "high"
tags:
  - "ci"
  - "pipeline"
  - "macos"
  - "cli"
  - "regression"
source: "smart-add"
startedAt: "2026-04-07T14:22:19.737Z"
completedAt: "2026-04-07T14:26:24.041Z"
acceptanceCriteria:
  - "Pipeline includes a distinct MacOS validation stage that runs after existing prerequisite setup and before final pipeline success is reported"
  - "The stage executes the documented install-and-run smoke script for n-dx using MacOS-appropriate commands"
  - "The stage records command exit codes and only the static response fields already considered deterministic by the current test contract"
  - "The stage does not assert on generated code, model-authored prose, or any other nondeterministic LLM output"
  - "A failure in any expected static response or exit code causes the MacOS stage to fail the pipeline with actionable diagnostics"
description: "Introduce a new CI stage that starts the requested MacOS-based container environment, installs n-dx using the repository's supported setup path, runs the agreed smoke commands, and captures only deterministic outputs and exit codes needed for validation without changing existing command logic."
---

# Add MacOS pipeline stage for ndx install-and-run smoke validation

🟠 [completed]

## Summary

Introduce a new CI stage that starts the requested MacOS-based container environment, installs n-dx using the repository's supported setup path, runs the agreed smoke commands, and captures only deterministic outputs and exit codes needed for validation without changing existing command logic.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** ci, pipeline, macos, cli, regression
- **Level:** task
- **Started:** 2026-04-07T14:22:19.737Z
- **Completed:** 2026-04-07T14:26:24.041Z
- **Duration:** 4m
