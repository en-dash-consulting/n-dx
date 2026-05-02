---
id: "1e04af28-ca65-4104-941e-af798af61373"
level: "task"
title: "Update rex read commands (status, next, validate) to read PRD from folder tree"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "cli"
  - "read"
source: "smart-add"
startedAt: "2026-04-27T23:36:47.595Z"
completedAt: "2026-04-28T00:06:30.846Z"
endedAt: "2026-04-28T00:06:30.846Z"
acceptanceCriteria:
  - "rex status output is identical when reading from folder tree vs single prd.md for the same PRD dataset"
  - "rex next selects the same task regardless of storage backend"
  - "rex validate reports the same issues whether reading from folder tree or single file"
  - "Commands emit a clear error when .rex/prd/ is absent and prd.md is also missing"
  - "Fallback detection: if prd/ folder is absent but prd.md exists, auto-trigger migration before reading"
description: "Wire rex status, rex next, and rex validate to read the PRD from the folder tree via the parser rather than from the legacy single-file store. Verify that command output is byte-for-byte identical to the single-file baseline for the same dataset, and that commands fall back gracefully when neither format is present."
---

# Update rex read commands (status, next, validate) to read PRD from folder tree

🟠 [completed]

## Summary

Wire rex status, rex next, and rex validate to read the PRD from the folder tree via the parser rather than from the legacy single-file store. Verify that command output is byte-for-byte identical to the single-file baseline for the same dataset, and that commands fall back gracefully when neither format is present.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** prd, cli, read
- **Level:** task
- **Started:** 2026-04-27T23:36:47.595Z
- **Completed:** 2026-04-28T00:06:30.846Z
- **Duration:** 29m
