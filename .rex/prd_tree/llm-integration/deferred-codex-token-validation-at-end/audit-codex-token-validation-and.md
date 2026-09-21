---
id: "4ac54c3d-9d24-40a8-a6c1-e9615fdf3e66"
level: "task"
title: "Audit Codex token validation and budget-check call sites within the hench work run loop"
status: "completed"
priority: "high"
tags:
  - "codex"
  - "tokens"
  - "hench"
source: "smart-add"
startedAt: "2026-04-16T14:47:56.641Z"
completedAt: "2026-04-16T14:53:05.737Z"
acceptanceCriteria:
  - "All mid-run Codex token validation and budget-check call sites are identified and documented"
  - "Each site is classified as 'safe to defer' or 'must remain mid-run' with a justification"
  - "Output includes file paths and approximate line numbers for each site"
description: "Trace every location in the hench agent loop and token-tracking infrastructure where Codex token counts are parsed, validated, or checked against budget limits during an active run. Produce a list of call sites that fire before run completion and classify each as safe-to-defer or requiring mid-run presence."
---
