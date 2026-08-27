---
id: "3befc04b-ce05-4d4e-9dad-ead139784587"
level: "task"
title: "Wire health warnings into rex add, analyze, and plan write paths"
status: "completed"
priority: "medium"
tags:
  - "rex"
blockedBy:
  - "bf1fd080-e3f7-4af9-8ee3-1626df8da8d7"
startedAt: "2026-03-24T19:58:51.037Z"
completedAt: "2026-03-24T20:09:26.598Z"
acceptanceCriteria:
  - "Warnings print after successful add/analyze/plan when thresholds crossed"
  - "Warnings suggest ndx reshape or rex reorganize"
  - "Warnings go to stderr, don't pollute stdout or JSON output"
  - "No warning when thresholds are not crossed"
description: "After rex add/analyze/plan successfully write to the PRD, run the structure health check and print any warnings to stderr. Warnings should suggest running /ndx-reshape or rex reorganize. Non-blocking — the command still succeeds."
---
