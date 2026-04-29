---
id: "49cac3e3-229d-4447-b1ea-b452f7879e92"
level: "task"
title: "Diagnostics, Fallbacks, and Test Coverage"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T08:27:41.683Z"
completedAt: "2026-02-21T08:27:41.683Z"
acceptanceCriteria: []
description: "Provide explicit diagnostics for missing usage metadata and add comprehensive tests for parsing and utilization math."
---

## Subtask: Implement API and UI diagnostics for missing or partial provider usage metadata

**ID:** `19b572be-f39a-41de-9953-7a6bb0224cc2`
**Status:** completed
**Priority:** high

Add explicit status fields and user-facing diagnostic messaging when vendor/model/token metadata is missing so failures are observable and debuggable.

**Acceptance Criteria**

- API responses include a diagnostic status when usage metadata is missing or partial
- UI renders cause-specific fallback messages instead of silent zero values
- Diagnostic state includes remediation hint for unavailable provider metadata

---

## Subtask: Add codex and claude regression tests for parsing, aggregation, and budget percentages

**ID:** `4e6ff2ba-200c-42c8-9ecb-1c1207f8402d`
**Status:** completed
**Priority:** high

Each Rex view currently places primary actions (Add, Prune, Filter, Refresh) in different positions — some inline with section headers, some floating, some embedded mid-content. Define a single page-header action bar pattern and apply it consistently across Dashboard, PRD tree, proposals, and validation pages.

**Acceptance Criteria**

- Tests cover codex and claude payload variants including missing fields
- Aggregation tests verify per-tool, per-vendor/model, task, and project totals
- Percentage tests verify correct outputs for normal, zero-budget, and missing-budget scenarios
- All Rex views with primary actions use the same header action bar layout
- Primary actions (Add, Filter, Refresh) appear in the top-right of their respective page header on every Rex view
- Secondary/contextual actions (per-item operations) remain in context menus or inline controls, not in the page header
- The action bar pattern is documented in a code comment or component prop contract for future contributors

---
