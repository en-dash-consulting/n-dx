---
id: "a591f15e-81d1-459d-a170-d81b6ae19ced"
type: "task"
title: "Assignee filter ignores assignees on tasks, which ndx work --mine honours"
slug: "assignee-filter-ignores-assignees-on"
summary: "The 'Mine' filter only looks at who owns a change, not who owns the tasks inside it, so it can hide work that is yours. This counts task owners too."
description: "Verdict: should-fix (severity medium-low), from the adversarial review of feat/assignee-picker-mine-filter.\n\nv2 selection matches when the task's or the change's assignee equals the actor; the new detail-panel picker lets users assign a task. assignableChanges (views/changes.ts) and assignableInboxRows (views/inbox.ts) read only change.assignee. Trigger: assign task T (in unassigned change C) to me and change D to me — Changes opens on Mine showing only D, C is hidden, and ndx work --mine runs T. With only T assigned, the default is All, contradicting 'defaults to Mine when the current user has assigned open items'.\n\nFix: /api/rex/changes (server/routes-rex/product.ts:665) emits the open-task assignees per change row (e.g. assignees: string[]); the filter and default match any of them."
acceptanceCriteria:
  - "Change rows from /api/rex/changes carry the assignees of their open tasks"
  - "The Mine and per-person filters show a change when the change or any of its open tasks is assigned to that person"
  - "The default is Mine when the current user is assigned only an open task"
  - "Tests cover a task-only assignment"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
