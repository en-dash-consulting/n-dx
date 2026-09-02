---
id: "08f6d0b0-9462-494e-adf9-2830113caede"
level: "task"
title: "Surface active vendor and model in ndx console output"
status: "completed"
priority: "medium"
tags:
  - "llm"
  - "ux"
  - "cli"
source: "smart-add"
startedAt: "2026-04-08T14:03:48.313Z"
completedAt: "2026-04-08T14:47:54.864Z"
acceptanceCriteria:
  - "All ndx commands that invoke an LLM (analyze, plan, work, recommend, add) print a single line at command start showing vendor, model ID, and source (configured | default)"
  - "The line is omitted in --quiet / --format=json modes to avoid breaking machine-readable output"
  - "If the resolved model differs from a previously cached model stored in a run artifact, a warning is emitted (e.g. 'model changed since last run')"
  - "E2E test asserts the vendor/model header is present in CLI stdout for at least one command in each package"
description: "Display the resolved vendor and model at the start of every ndx command that performs LLM calls, so operators can confirm what is being used without inspecting config files. The output should show the vendor name, resolved model ID, and whether the model was explicitly configured or defaulted. This replaces any existing ad-hoc model logging and provides a consistent prefix line across commands."
---
