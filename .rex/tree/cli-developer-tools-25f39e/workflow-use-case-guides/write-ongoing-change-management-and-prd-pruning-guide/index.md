---
id: "bd466646-bb0a-400a-a56d-2b67876a2f30"
level: "task"
title: "Write Ongoing Change Management and PRD Pruning Guide"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "change-management"
  - "pruning"
source: "smart-add"
startedAt: "2026-04-14T15:51:35.714Z"
completedAt: "2026-04-14T15:51:35.714Z"
acceptanceCriteria:
  - "Guide covers the maintenance loop: periodic `ndx plan` re-analysis → `rex prune` → `rex reshape` → `ndx recommend` acknowledgment"
  - "Guide explains how to identify PRD drift (completed items still marked pending, obsolete epics, orphaned tasks) and resolve it"
  - "Guide includes recommended cadence guidance (e.g., post-sprint pruning, monthly self-heal pass)"
  - "Guide documents `ndx sync` for teams using a Notion or external adapter to keep the PRD accessible outside the CLI"
  - "Guide explains the archive mechanism (`.rex/archive.json`) and how to recover pruned items if needed"
  - "A developer maintaining an active project can follow the guide to restore PRD health after 2–3 months of active development"
description: "Document how to keep n-dx useful over the life of a project — not just at initial setup, but as the codebase evolves, features are completed, and the PRD drifts from reality. Covers periodic re-analysis with `ndx plan`, pruning completed or stale items with `rex prune` and `rex reshape`, using `ndx recommend --acknowledge` to dismiss resolved findings, and establishing a cadence for self-healing passes. Includes guidance on when to push to upstream remote and how to use `ndx sync` for adapter-backed PRDs."
---

# Write Ongoing Change Management and PRD Pruning Guide

🟠 [completed]

## Summary

Document how to keep n-dx useful over the life of a project — not just at initial setup, but as the codebase evolves, features are completed, and the PRD drifts from reality. Covers periodic re-analysis with `ndx plan`, pruning completed or stale items with `rex prune` and `rex reshape`, using `ndx recommend --acknowledge` to dismiss resolved findings, and establishing a cadence for self-healing passes. Includes guidance on when to push to upstream remote and how to use `ndx sync` for adapter-backed PRDs.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, change-management, pruning
- **Level:** task
- **Started:** 2026-04-14T15:51:35.714Z
- **Completed:** 2026-04-14T15:51:35.714Z
- **Duration:** < 1m
