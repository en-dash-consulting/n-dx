---
id: "238c6bbe-efc7-478f-8dfd-e3a1414de563"
level: "task"
title: "Fallback Output Semantics and Metadata"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T02:07:03.655Z"
completedAt: "2026-02-23T02:07:03.655Z"
acceptanceCriteria: []
description: "Make fallback output explicit, reviewable, and trustworthy by labeling mode and attaching measurable coverage and confidence signals."
---

## Subtask: Render explicit fallback-mode labeling in generated PR markdown

**ID:** `cf3dad3f-3dec-4023-9d8e-a59a691bfc68`
**Status:** completed
**Priority:** high

Prevent reviewer confusion by clearly marking markdown generated without git diff data and documenting the substitute evidence sources used.

**Acceptance Criteria**

- Generated markdown includes a visible fallback mode label in the overview section
- Markdown lists the evidence sources used (Rex, Hench) when present
- Primary non-fallback markdown template remains unchanged when git diff succeeds

---

## Subtask: Compute fallback confidence and coverage metrics from available evidence

**ID:** `c8dbfc26-bf45-491d-8672-ccaf886f7d9d`
**Status:** completed
**Priority:** high

Quantify how complete and reliable the fallback summary is so reviewers can judge risk when git data is unavailable.

**Acceptance Criteria**

- Coverage metric reports percentage of expected evidence sources found among configured fallback inputs
- Confidence score decreases when required inputs are missing and increases when both Rex and Hench evidence are present
- Metric outputs are deterministic for identical input artifacts

---

## Subtask: Expose fallback metadata in refresh API and cached artifact payload

**ID:** `84d796df-b8f1-46cc-988e-c77c86412bf7`
**Status:** completed
**Priority:** high

Persist and return mode, confidence, and coverage fields so UI and downstream automation can distinguish fallback outputs programmatically.

**Acceptance Criteria**

- Refresh API response includes mode, confidence, and coverage fields when fallback is used
- Cached PR markdown artifact stores the same fallback metadata fields alongside content
- Non-fallback responses explicitly report normal mode and do not include stale fallback metadata

---
