---
id: "adbfffa8-d6bb-4427-b464-c5db4186f03c"
level: "feature"
title: "Prepare task phase 2: settings saved on the task, honoured everywhere (plus R0 effort data)"
status: "pending"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
acceptanceCriteria: []
description: "Phase 2 of the Prepare task design (workshop analysis/task-prep/02-task-prep-design.md §6, §7.2 R0, §10 TP5/TP7/TP8/TP9). Builds on phase 1 (feature 912477b2, PR #503). Branch feat/090-task-prep-phase2.\n\nRun settings chosen in the Prepare task modal can be saved on the task (a declared `run` field on the PRD item) and are honoured by `ndx work` in a terminal as well as by the dashboard, with precedence CLI flag > task run > hench.* > llm.* > default, per task inside loops. Bundles R0: stop losing the loe / loeRationale / loeConfidence data the LLM already produces, and make the run record's weight and model source honest."
lastModified: "2026-10-05T17:27:29.835Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Declare the run field on PRD items and make front-matter fields round-trip with their types (incl. R0 LoE storage)](./declare-the-run-field-on-prd-items-and.md) | pending |
| [Docs and changesets: run field, LoE fields, saved settings in ndx work and the dashboard](./docs-and-changesets-run-field-loe.md) | pending |
| [hench: --no-review and --no-skip-test-gate turn a saved setting off for one run](./hench-no-review-and-no-skip-test-gate.md) | pending |
| [hench --resolve: report the saved block, each saved setting's fallback, and keep saved settings out of the printed command](./hench-resolve-report-the-saved-block.md) | pending |
| [hench: resolve run settings per task after selection, honour task.run with CLI > task > hench > llm > default, record the tier and model source actually used](./hench-resolve-run-settings-per-task.md) | pending |
| [Prepare task modal: Save, Reset to defaults, saved-on-task sources, conflict state, off-anchor notice; saved dot on Ready to run](./prepare-task-modal-save-reset-to.md) | pending |
| [R0: keep loe, loeRationale and loeConfidence on every proposal accept path](./r0-keep-loe-loerationale-and.md) | pending |
| [web: PUT /api/hench/prep/:taskId saves run settings on the task with a version check; prep and ready report saved state](./web-put-api-hench-prep-taskid-saves.md) | pending |
| [Write run through MCP add_item/edit_item and rex update --run, and allow-list PATCH /api/rex/items/:id](./write-run-through-mcp-add-item-edit.md) | pending |
