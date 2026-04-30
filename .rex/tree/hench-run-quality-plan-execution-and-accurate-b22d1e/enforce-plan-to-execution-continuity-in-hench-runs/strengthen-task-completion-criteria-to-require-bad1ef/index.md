---
id: "bad1ef80-40ca-44b1-8d8b-eff1b4b0ecd5"
level: "task"
title: "Strengthen task-completion criteria to require evidence of code changes for code-classified tasks"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "prd"
  - "completion-gate"
source: "smart-add"
acceptanceCriteria:
  - "Status transition to completed for code-classified tasks is rejected when the run produced zero code file changes"
  - "Rejection emits a structured run failure with actionable message naming the task and the missing-change reason"
  - "Existing change-classifier (code/docs/config/metadata-only) is the single source of truth for the gate"
  - "Regression test covers: code task + zero changes (rejected), code task + changes (accepted), docs-only task + zero code changes (accepted)"
description: "Tighten the existing 'transparent task selection and completion reasoning' classification so that tasks classified as code work cannot transition to completed without at least one staged or committed file change attributable to the run. Tasks classified as docs/config/metadata-only retain current behavior."
---

# Strengthen task-completion criteria to require evidence of code changes for code-classified tasks

🟠 [pending]

## Summary

Tighten the existing 'transparent task selection and completion reasoning' classification so that tasks classified as code work cannot transition to completed without at least one staged or committed file change attributable to the run. Tasks classified as docs/config/metadata-only retain current behavior.

## Info

- **Status:** pending
- **Priority:** high
- **Tags:** hench, prd, completion-gate
- **Level:** task
