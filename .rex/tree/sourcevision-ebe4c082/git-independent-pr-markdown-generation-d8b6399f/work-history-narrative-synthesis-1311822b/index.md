---
id: "1311822b-671e-4fc4-93a0-816540324e25"
level: "task"
title: "Work-History Narrative Synthesis"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T04:50:23.155Z"
completedAt: "2026-02-23T04:50:23.155Z"
acceptanceCriteria: []
description: "Generate reviewer-ready PR markdown from completed Rex tasks and corresponding Hench execution history in a consistent structure."
---

## Subtask: Generate PR sections from executed Rex tasks grouped by epic

**ID:** `ffc5324f-2a02-4ea0-be64-ec22d5441e04`
**Status:** completed
**Priority:** high

Create structured markdown sections that group completed branch work by epic and feature so reviewers can quickly understand scope and intent.

**Acceptance Criteria**

- Generated markdown includes epic headings and task-level bullet summaries
- Only completed or explicitly executed tasks are included in the default narrative
- Snapshot tests verify stable section ordering across repeated runs

---

## Subtask: Attach execution evidence badges to summarized tasks

**ID:** `1a2b9518-e532-4cf1-a69e-d258c7482519`
**Status:** completed
**Priority:** high

Annotate summarized tasks with lightweight execution evidence from Hench (for example run status and timestamp) to improve trust in branch-history-based summaries.

**Acceptance Criteria**

- Each summarized task shows execution evidence when matching Hench data exists
- Tasks without execution evidence are clearly labeled as no run evidence
- Tests validate badge rendering for success, failure, and missing-evidence cases

---
