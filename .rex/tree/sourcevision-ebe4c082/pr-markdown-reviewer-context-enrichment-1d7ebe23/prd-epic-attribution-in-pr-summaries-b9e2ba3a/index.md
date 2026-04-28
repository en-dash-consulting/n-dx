---
id: "b9e2ba3a-809b-4796-994b-42a4e0757a18"
level: "task"
title: "PRD Epic Attribution in PR Summaries"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T22:20:05.323Z"
completedAt: "2026-02-22T22:20:05.323Z"
description: "Connect branch work to PRD context so reviewers can quickly understand which planned initiatives the changes implement."
---

## Subtask: Implement branch-to-PRD work item resolver

**ID:** `fb4d883e-12aa-4d65-8eed-a7dd9b5514d3`
**Status:** completed
**Priority:** critical

Create a resolver that maps branch changes to completed or in-progress PRD tasks and derives their parent epic titles, so PR summaries can show intent-level context instead of only code-level changes.

**Acceptance Criteria**

- Given a branch with linked PRD task activity, resolver returns unique parent epic titles
- Resolver excludes deleted PRD items and items not touched by branch work
- Resolver output is deterministic across repeated runs on the same git/PRD state

---

## Subtask: Render worked-on epic titles in PR markdown overview

**ID:** `1680e5cb-b116-481f-93e6-e414b7e82651`
**Status:** completed
**Priority:** high

Add a dedicated section near the top of generated PR markdown that lists PRD epic titles worked on by the branch, so reviewers immediately see strategic scope.

**Acceptance Criteria**

- Generated markdown includes a 'Worked PRD Epics' section when at least one epic is resolved
- Epic titles are de-duplicated and presented in stable order
- When no epic mapping exists, markdown shows a concise fallback message rather than an empty section

---
