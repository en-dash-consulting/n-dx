---
id: "9a56a5a1-ee74-4e34-8f6a-185e5490b760"
level: "task"
title: "Typography and Text Rendering Fixes"
status: "completed"
source: "smart-add"
startedAt: "2026-03-03T08:57:59.556Z"
completedAt: "2026-03-03T08:57:59.556Z"
acceptanceCriteria: []
description: "Address small, broken, and inconsistently sized text across all Rex pages — including task cards, detail panels, status badges, and section headers"
---

## Subtask: Audit and fix font size and weight inconsistencies across Rex pages

**ID:** `a06d1971-0b90-47be-aebd-c7bb5f233f78`
**Status:** completed
**Priority:** high

Walk every Rex view (Dashboard, PRD tree, task detail, proposals, validation, token usage) and produce a consistent type scale. Currently some labels render at unreadable sizes and headings vary arbitrarily between pages, making the UI feel unfinished.

**Acceptance Criteria**

- All body text in Rex views uses a single consistent base size
- Heading levels (h2/h3/h4) map to a documented type scale and do not vary between pages
- No label or status badge text is smaller than 11px
- Changes verified visually at 1280px and 1440px viewport widths

---

## Subtask: Fix text overflow and truncation in task cards and detail panels

**ID:** `6f4539a3-24d9-48a5-84d1-4b9a1c0ea1d7`
**Status:** completed
**Priority:** high

Long task titles and descriptions currently overflow their containers or get clipped without ellipsis, and tooltip fallbacks are missing. This makes content unreadable without expanding items manually.

**Acceptance Criteria**

- Task titles truncate with ellipsis at container boundary and show full text in a tooltip on hover
- Description text in detail panels wraps correctly and does not overflow its scrollable region
- Epic and feature titles in the PRD tree do not bleed outside their nodes
- Behavior verified with titles of 30, 80, and 150 characters

---
