---
id: "b5fb8f1e-e10b-4583-bf65-57127223b477"
level: "task"
title: "Significant Change Narrative"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T22:15:55.948Z"
completedAt: "2026-02-22T22:15:55.948Z"
description: "Shift PR markdown toward human-readable explanation of important functional and feature-level changes, minimizing noisy implementation detail."
---

## Subtask: Implement significant-function and feature highlight extraction

**ID:** `31df5054-0a49-4456-a6b4-d11db72235ea`
**Status:** completed
**Priority:** critical

Add logic to identify newly added or materially changed high-impact functions and user-visible features, enabling summaries that focus on reviewer-relevant changes.

**Acceptance Criteria**

- Extractor identifies added/modified exported functions and routes/components touched in the branch
- Output includes concise rationale for why each highlight is significant
- Low-signal refactors (e.g., rename-only or formatting-only diffs) are excluded from highlights

---

## Subtask: Generate reviewer-first overview section without file/line enumerations

**ID:** `bd23cd77-1f6e-45cf-988e-8bbd4e2556dd`
**Status:** completed
**Priority:** high

Update markdown generation to present a compact narrative of important changes and explicitly avoid long file-by-file or line-by-line lists that reduce review clarity.

**Acceptance Criteria**

- Default PR markdown contains an 'Important Changes' narrative section with feature/function summaries
- Default output does not include exhaustive per-file change listings or line-count tables
- Integration tests fail if generator reintroduces long file/line enumeration patterns in default mode

---
