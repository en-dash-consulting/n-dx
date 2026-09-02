---
id: "dee5cd0a-3cea-4a95-a549-921c0fe7940f"
level: "task"
title: "Add --capture-only flag to ndx self-heal to persist recommendations without executing them"
status: "completed"
priority: "medium"
tags:
  - "self-heal"
  - "cli"
  - "docs"
source: "smart-add"
startedAt: "2026-05-15T21:39:02.368Z"
completedAt: "2026-05-15T21:48:30.100Z"
endedAt: "2026-05-15T21:48:30.100Z"
resolutionType: "code-change"
resolutionDetail: "Added --capture-only flag to handleSelfHeal in cli.js; updated help.js and self-heal.md; added 8 integration tests"
acceptanceCriteria:
  - "`ndx self-heal --capture-only` runs analyze + recommend, writes tagged items to the PRD, and exits with status 0 without starting any hench run"
  - "`ndx self-heal` (no flag) preserves existing behavior end-to-end, only with persistence now occurring before execution"
  - "`ndx self-heal --help` documents `--capture-only` and clarifies the distinction between capture and execution"
  - "Integration test asserts capture-only mode produces PRD items and does not spawn a hench run"
  - "Workflow docs / self-healing guide reference the capture-only mode"
description: "Introduce a `--capture-only` (or equivalent) flag on `ndx self-heal` that runs the analyze → recommend → persist-to-PRD pipeline and then exits without invoking the hench execution loop. This gives users an explicit way to use self-heal purely as a PRD-population step. Update help text, the workflow guide, and CLI hint surfaces to describe the new mode."
---
