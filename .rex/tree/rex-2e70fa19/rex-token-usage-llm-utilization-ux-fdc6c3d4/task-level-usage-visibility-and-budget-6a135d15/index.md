---
id: "6a135d15-14d8-4983-b2f7-1e136bbb3c1c"
level: "task"
title: "Task-Level Usage Visibility and Budget Context"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T08:19:46.249Z"
completedAt: "2026-02-21T08:19:46.249Z"
description: "Introduce a feature toggle (default off) that controls whether token budget information appears on Rex task line items and in the side panel. Regardless of the toggle, non-zero token usage should render as a compact badge. Improve the hench run association surface so the run and its token burn are clearly surfaced alongside the task."
---

## Subtask: Repair task token tag binding to accumulated usage totals

**ID:** `010a83aa-122c-41a0-94a4-27015cb6e1ae`
**Status:** completed
**Priority:** critical

Fix task metadata mapping so each task reflects real summed usage from associated runs rather than stale or defaulted values.

**Acceptance Criteria**

- Task list and task detail views show identical token totals for the same task
- Totals update after new runs without manual data edits
- Tasks with no associated usage render explicit zero state instead of blank

---

## Subtask: Display task-level weekly budget percentage in task chips and details

**ID:** `668beae8-713d-40cd-85b4-903ffec05287`
**Status:** completed
**Priority:** high

Show each task’s share of weekly budget using vendor/model-aware percentages so users can identify high-cost work quickly.

**Acceptance Criteria**

- Each task with usage shows percentage of weekly budget next to token count
- Percentage uses the budget that matches the task’s vendor/model usage source
- When budget is missing, UI shows deterministic fallback label and no invalid percentage

---

## Subtask: Add 'showTokenBudget' feature toggle with default-off configuration

**ID:** `49bbec5f-c725-4bfa-8c3c-755a6aabe30f`
**Status:** completed
**Priority:** high

Introduce a new feature toggle key (e.g. `showTokenBudget`) in the n-dx feature toggle system. It must default to false so token budget UI is hidden out-of-the-box. The toggle should be accessible via `ndx config` and the existing feature toggle configuration section in the web UI. Document the toggle in CLI help.

**Acceptance Criteria**

- A `showTokenBudget` toggle key exists in the feature toggle schema and defaults to false
- `ndx config` can read and write the toggle
- The web UI feature toggle configuration section lists and toggles `showTokenBudget`
- CLI help text references the new toggle

---

## Subtask: Conditionally hide token budget in task line items and detail panel based on toggle

**ID:** `5f605950-00bc-41c0-800a-f62f381a82a8`
**Status:** completed
**Priority:** high

In the Rex task list and detail side panel, gate all token-budget-specific UI (budget bar, budget percentage chip, budget limit label) behind the `showTokenBudget` feature toggle. When the toggle is off these elements must not render at all — not just hidden via CSS. Token usage counts (already present) are unaffected.

**Acceptance Criteria**

- When `showTokenBudget` is false, no budget bar, budget percentage, or budget limit label appears on task line items
- When `showTokenBudget` is false, no budget-related fields appear in the task detail side panel
- When `showTokenBudget` is true, budget UI renders as before
- Toggling the setting live (without page reload) updates the display

---

## Subtask: Render non-zero token usage as a compact badge on task line items

**ID:** `499fa24f-b0bd-4627-8099-f1c5c5233df4`
**Status:** completed
**Priority:** high

On every Rex task line item, display a small token usage badge (e.g. '1.2k tokens') when the task has accumulated non-zero usage. The badge must appear regardless of the `showTokenBudget` toggle — it is always visible when there is usage to show. Use a neutral chip style distinct from status badges. Zero-usage tasks show no badge.

**Acceptance Criteria**

- Tasks with non-zero token usage display a compact usage badge on the line item
- Tasks with zero token usage show no badge
- The badge renders when `showTokenBudget` is false
- The badge renders when `showTokenBudget` is true
- Badge value is human-readable (e.g. '1.2k', '45k') with a token icon or label

---

## Subtask: Improve hench run association and token burn display in task detail panel

**ID:** `e95e1878-7f00-4f9d-880f-fb830bb59ce2`
**Status:** completed
**Priority:** medium

In the Rex task detail side panel, surface the associated hench run(s) more prominently: show the run ID or summary, execution time, and per-run token burn. When multiple runs exist, list them in reverse chronological order with individual burn totals. Deep-link each run entry to the Hench Runs view. This gives users direct visibility into how much of a task's token cost came from each execution.

**Acceptance Criteria**

- The task detail panel lists all hench runs associated with the task
- Each run entry shows: run ID (or timestamp), status, and token burn for that run
- Runs are ordered most-recent first
- Each run entry is a clickable deep-link to the Hench Runs view for that run
- If no runs are associated, the section is hidden or shows 'No runs yet'
- Total token burn across all runs matches the task-level usage badge value

---
