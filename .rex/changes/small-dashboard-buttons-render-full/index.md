---
id: "abb99ee3-d774-4c29-a109-2f3d82286f17"
type: "change"
title: "Small dashboard buttons render full-size because .btn-sm has no style"
slug: "small-dashboard-buttons-render-full"
summary: "Buttons the dashboard marks as small actually render at full size, because the small-button style was never written. Defining it makes compact controls look compact everywhere."
intent: "Found while fixing the detail-panel assignee buttons (fix/plan-analyze-ui-polish): about 28 call sites in packages/web use the `btn-sm` class, but no stylesheet defines it, so those buttons fall back to the full `.btn` size. The assignee form was fixed locally; the rest still render oversized."
acceptanceCriteria:
  - "A `.btn-sm` style exists in the shared button styles, built from existing size and spacing tokens"
  - "Every current `btn-sm` call site renders at the small size; the assignee form's local override is removed if it becomes redundant"
  - "A style test fails if a class used in viewer markup as btn-sm has no matching rule"
touches:
  - "a58edbcf-4588-47ef-9c99-eb02aac46f41"
priority: "low"
source: "ndx-capture"
---
