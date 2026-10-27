---
id: "bad1ef80-40ca-44b1-8d8b-eff1b4b0ecd5"
type: "change"
title: "Strengthen task-completion criteria to require evidence of code changes for code-classified tasks"
slug: "strengthen-task-completion-criteria-to"
intent: "Tighten the existing 'transparent task selection and completion reasoning' classification so that tasks classified as code work cannot transition to completed without at least one staged or committed file change attributable to the run. Tasks classified as docs/config/metadata-only retain current behavior."
acceptanceCriteria:
  - "Status transition to completed for code-classified tasks is rejected when the run produced zero code file changes"
  - "Rejection emits a structured run failure with actionable message naming the task and the missing-change reason"
  - "Existing change-classifier (code/docs/config/metadata-only) is the single source of truth for the gate"
  - "Regression test covers: code task + zero changes (rejected), code task + changes (accepted), docs-only task + zero code changes (accepted)"
touches:
  - "e08fe050-bded-4ff2-9e4f-46d55cbfc93f"
priority: "high"
tags:
  - "hench"
  - "prd"
  - "completion-gate"
source: "smart-add"
---
