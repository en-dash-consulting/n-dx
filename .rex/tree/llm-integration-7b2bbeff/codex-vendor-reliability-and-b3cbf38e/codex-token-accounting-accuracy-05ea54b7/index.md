---
id: "05ea54b7-08c2-4134-a051-fa936e7e8c4d"
level: "task"
title: "Codex Token Accounting Accuracy"
status: "completed"
source: "smart-add"
startedAt: "2026-02-20T22:35:55.356Z"
completedAt: "2026-02-20T22:35:55.356Z"
description: "Ensure Hench records token usage correctly in Codex mode so usage reporting and budget enforcement remain trustworthy."
---

## Subtask: Map Codex usage payloads to unified token metrics

**ID:** `43efef27-b698-491c-87ee-d933b3526d20`
**Status:** completed
**Priority:** critical

Implement explicit field mapping from Codex response usage data into the shared token accounting model used by Hench and Rex reports.

**Acceptance Criteria**

- Input, output, and total token counts are populated from Codex usage data when available
- When usage is absent, accounting records zero values plus a non-fatal diagnostic flag
- Token mapping logic is isolated in a reusable function with unit tests

---

## Subtask: Validate Codex token totals in run summaries and budget checks

**ID:** `2a84a66e-f407-446f-9ff8-d3e295a68f08`
**Status:** completed
**Priority:** high

Wire mapped token metrics into run persistence and budget logic so Codex-mode runs affect totals identically to existing vendors.

**Acceptance Criteria**

- Run summary output includes Codex-derived token totals
- Budget threshold warnings trigger correctly for Codex-mode runs
- Integration test confirms cumulative token totals increase after a Codex-mode execution

---
