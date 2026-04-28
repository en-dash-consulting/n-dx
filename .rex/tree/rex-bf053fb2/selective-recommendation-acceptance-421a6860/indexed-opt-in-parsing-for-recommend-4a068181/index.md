---
id: "4a068181-10e1-45d7-978f-69dc97e77b17"
level: "task"
title: "Indexed opt-in parsing for `recommend --accept`"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T02:57:21.360Z"
completedAt: "2026-02-21T02:57:21.360Z"
description: "Allow users to accept only specific recommended items by providing an equals-prefixed index list (for example `=1,4,5`) instead of accepting all recommendations."
---

## Subtask: Implement equals-prefixed index selector parsing for `recommend --accept`

**ID:** `5842771b-a09a-4c03-969b-87d4d8be4ad0`
**Status:** completed
**Priority:** critical

Add command parsing support for values like `=1,4,5` so users can target specific recommendation indices without changing existing all-accept behavior.

**Acceptance Criteria**

- Running `recommend --accept =1,4,5` parses indices as [1,4,5] when at least 5 recommendations exist
- Parsing ignores surrounding whitespace in inputs like `=1, 4, 5`
- Existing `recommend --accept` behavior without an equals selector remains unchanged

---

## Subtask: Apply indexed selection to recommendation acceptance workflow

**ID:** `8475a81e-79d1-49ba-8d04-39e1928fa6fe`
**Status:** completed
**Priority:** critical

Wire parsed indices into the acceptance pipeline so only selected recommended items are accepted and persisted, preserving original recommendation ordering.

**Acceptance Criteria**

- Only specified indices are accepted and written to PRD state
- Unselected recommendations remain pending and are not mutated
- Accepted items preserve the same relative order they had in the recommendation list

---
