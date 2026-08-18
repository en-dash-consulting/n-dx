---
id: "7ac28a47-1e4f-414c-9ff3-f6e86fd5dfc2"
level: "task"
title: "Single shared lock for sv-analyze, refresh, and ci (.sourcevision writers)"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "Starting any of sv-analyze (quick or full), refresh, or ci while another is running returns 409 naming the in-flight job"
  - "The quick sv-analyze path is guarded by the same lock"
blockedBy:
  - "35a6da7c-a1a4-496a-8189-9cee15e5b486"
description: "svAnalyzeStatus.running, refreshStatus.running, and ciStatus.running guard only themselves, but sv-analyze --full, ndx refresh --data-only, and ndx ci all write .sourcevision/ — any two can run concurrently from dashboard buttons, which the CLAUDE.md concurrency contract prohibits (ndx ci + write commands, ndx refresh + any write command). The quick sv-analyze path (routes-commands.ts:247) has no guard at all, so a quick re-analyze can start on top of a full run. Fix: one shared lock covering sv-analyze (all modes), refresh, and ci, returning 409 naming whatever is in flight."
---
