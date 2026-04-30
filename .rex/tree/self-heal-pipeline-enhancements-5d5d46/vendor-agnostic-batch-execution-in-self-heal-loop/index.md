---
id: "e0d22237-06af-4147-a3d7-c3a95c202d59"
level: "feature"
title: "Vendor-Agnostic Batch Execution in Self-Heal Loop"
status: "completed"
source: "smart-add"
startedAt: "2026-04-14T21:36:07.553Z"
completedAt: "2026-04-14T21:36:07.553Z"
acceptanceCriteria: []
description: "The self-heal loop batch processing fails when the active vendor is Codex. Batches must execute reliably regardless of whether Claude or Codex is configured, covering prompt format differences, response parsing, token budgeting, and error recovery paths."
---

# Vendor-Agnostic Batch Execution in Self-Heal Loop

 [completed]

## Summary

The self-heal loop batch processing fails when the active vendor is Codex. Batches must execute reliably regardless of whether Claude or Codex is configured, covering prompt format differences, response parsing, token budgeting, and error recovery paths.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests for Codex batch execution in the self-heal pipeline | task | completed | 2026-04-14 |
| Add vendor-resilient error handling and retry logic for self-heal batch failures | task | completed | 2026-04-14 |
| Audit self-heal batch pipeline for Codex incompatibilities | task | completed | 2026-04-14 |
| Implement vendor-aware batch construction and response handling in self-heal | task | completed | 2026-04-14 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-14T21:36:07.553Z
- **Completed:** 2026-04-14T21:36:07.553Z
- **Duration:** < 1m
