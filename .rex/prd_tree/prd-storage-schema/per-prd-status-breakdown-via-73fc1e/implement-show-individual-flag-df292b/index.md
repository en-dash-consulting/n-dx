---
id: "df292b37-e2f6-448f-ba8b-22f6f301a41e"
level: "task"
title: "Implement --show-individual flag for ndx status with per-PRD breakdown"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "status"
source: "smart-add"
startedAt: "2026-04-27T05:35:57.785Z"
completedAt: "2026-04-27T13:13:51.778Z"
resolutionType: "code-change"
resolutionDetail: "Implemented --show-individual flag for ndx/rex status with per-PRD breakdown (sections + JSON array)"
acceptanceCriteria:
  - "ndx status --show-individual prints one labeled section per PRD file (canonical .rex/prd.md plus any branch-scoped .rex/prd_{branch}_{date}.md)"
  - "Each section shows the PRD file path and per-file completion stats (total/completed/pending counts)"
  - "Items are attributed to their source PRD file using existing branch/source-file metadata; no item appears in more than one section"
  - "--format=json with --show-individual emits an array where each element has prdPath, stats, and items fields"
  - "When only one PRD file exists, the flag still works and produces a single section without error"
  - "Help text for ndx status documents the new flag with a brief usage example"
  - "Integration test covers both single-PRD and multi-PRD scenarios in human and JSON output modes"
description: "Extend ndx status (and rex status) with a --show-individual flag that, instead of showing the merged aggregate tree, prints status sections grouped by source PRD file. Each section should include the PRD file path, a header, and the same stats/tree the default status produces but scoped to items originating from that file. Honor existing flags (--format=json, filters) by emitting an array of per-PRD status objects in JSON mode."
---

# Implement --show-individual flag for ndx status with per-PRD breakdown

🟡 [completed]

## Summary

Extend ndx status (and rex status) with a --show-individual flag that, instead of showing the merged aggregate tree, prints status sections grouped by source PRD file. Each section should include the PRD file path, a header, and the same stats/tree the default status produces but scoped to items originating from that file. Honor existing flags (--format=json, filters) by emitting an array of per-PRD status objects in JSON mode.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** rex, cli, status
- **Level:** task
- **Started:** 2026-04-27T05:35:57.785Z
- **Completed:** 2026-04-27T13:13:51.778Z
- **Duration:** 7h 37m
