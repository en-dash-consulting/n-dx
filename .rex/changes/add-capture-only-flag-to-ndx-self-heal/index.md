---
id: "dee5cd0a-3cea-4a95-a549-921c0fe7940f"
type: "change"
title: "Add --capture-only flag to ndx self-heal to persist recommendations without executing them"
slug: "add-capture-only-flag-to-ndx-self-heal"
intent: "Introduce a `--capture-only` (or equivalent) flag on `ndx self-heal` that runs the analyze → recommend → persist-to-PRD pipeline and then exits without invoking the hench execution loop. This gives users an explicit way to use self-heal purely as a PRD-population step. Update help text, the workflow guide, and CLI hint surfaces to describe the new mode."
acceptanceCriteria:
  - "`ndx self-heal --capture-only` runs analyze + recommend, writes tagged items to the PRD, and exits with status 0 without starting any hench run"
  - "`ndx self-heal` (no flag) preserves existing behavior end-to-end, only with persistence now occurring before execution"
  - "`ndx self-heal --help` documents `--capture-only` and clarifies the distinction between capture and execution"
  - "Integration test asserts capture-only mode produces PRD items and does not spawn a hench run"
  - "Workflow docs / self-healing guide reference the capture-only mode"
amends: [{"target":"a7b15854-0a39-4143-9d4c-066d4b05610b","delta":"modified","summary":"Add --capture-only flag to ndx self-heal to persist recommendations without executing them","base":"e60d772a7a61b91d4d70e57a558af6b9f03eed0444f5d292f04458f6c03eac23"}]
priority: "medium"
tags:
  - "self-heal"
  - "cli"
  - "docs"
source: "smart-add"
---
