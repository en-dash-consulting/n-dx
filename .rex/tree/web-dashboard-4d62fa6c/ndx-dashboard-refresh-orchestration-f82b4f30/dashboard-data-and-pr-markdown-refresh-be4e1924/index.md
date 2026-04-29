---
id: "be4e1924-967b-40aa-a76b-c05287f04df6"
level: "task"
title: "Dashboard Data and PR Markdown Refresh Flow"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T19:40:48.516Z"
completedAt: "2026-02-21T19:40:48.516Z"
acceptanceCriteria: []
description: "Refresh SourceVision-derived dashboard data and explicitly support PR markdown cache regeneration within the same orchestration command."
---

## Subtask: Implement SourceVision-derived dashboard artifact refresh step

**ID:** `2233cb88-5b78-4ac5-bd8b-0eb75de7d1b0`
**Status:** completed
**Priority:** critical

Add orchestration logic that refreshes generated dashboard artifacts used by the web UI so analysis-derived views stay synchronized with repository state.

**Acceptance Criteria**

- Default `ndx refresh` runs a data refresh step for SourceVision-derived dashboard artifacts.
- `ndx refresh --data-only` runs data refresh steps without running UI build steps.
- A successful run updates artifact timestamps or metadata that can be inspected after completion.

---

## Subtask: Integrate PR markdown cache refresh into `ndx refresh` flow

**ID:** `4fd25898-288f-4400-a79a-3d796165fffa`
**Status:** completed
**Priority:** high

Wire PR markdown generation/cache refresh into the orchestration pipeline so users can refresh copy-ready PR content from one command.

**Acceptance Criteria**

- Default `ndx refresh` includes PR markdown cache refresh as part of data refresh.
- `ndx refresh --pr-markdown` triggers PR markdown cache refresh and skips unrelated steps.
- If PR markdown refresh fails, command marks that step failed and returns non-zero status while preserving prior step results in output.

---
