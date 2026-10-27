---
id: "7fefed1c-bdb4-47af-b35f-36985135ac1f"
type: "capability"
title: "Deterministic Task Utilization Budget Fallback"
slug: "deterministic-task-utilization-budget"
statement: "The system computes task-level utilization from weekly token budgets resolved deterministically by vendor and model, and falls back to a consistent state when no budget is configured or a budget is only partly configured."
criteria: [{"id":"c1","text":"The system shall resolve the weekly token budget for task-level utilization through a deterministic vendor/model resolution path."},{"id":"c2","text":"If no weekly token budget resolves from a known source, the system shall compute task-level utilization from a consistent fallback state."},{"id":"c3","text":"When weekly budgets are missing, the task-level utilization chips and details shall show a deterministic fallback display."},{"id":"c4","text":"When weekly budgets are only partly configured, the task-level utilization chips and details shall show a deterministic fallback display."}]
source: "smart-add"
---
