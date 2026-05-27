---
"@n-dx/web": patch
---

PRD tree row decluttered. The Token Usage cell is now gated on the
`showTokenBudget` feature flag (no more noisy column on every row when
budgets aren't active). Duration and timestamp are removed from the
row — both still live in the task detail flyout. The level badge
(`EPIC` / `FEATURE` / `TASK` / `SUBTASK`) now renders only on the
first item of each contiguous same-level group, so it reads as a
section header for that indentation instead of repeating on every
row. Status remains an icon-only indicator with the full label on
hover.
