---
id: "8be8d4fd-186f-4b70-b7ab-7c91f8a57134"
level: "task"
title: "Implement PRD file discovery and selection logic within the .rex directory"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
source: "smart-add"
startedAt: "2026-04-22T16:25:47.661Z"
completedAt: "2026-04-22T16:30:27.341Z"
resolutionType: "code-change"
resolutionDetail: "Implemented PRD file discovery and selection logic in packages/rex/src/store/prd-discovery.ts with 24 unit tests."
acceptanceCriteria:
  - "Discovers all prd_*.json files in the .rex/ directory via glob pattern"
  - "Matches discovered files to the current branch by parsing the branch segment from filenames"
  - "Returns the existing PRD file path when one matches the current branch"
  - "Creates a new empty PRD file with correct naming when no match exists for the current branch"
  - "Handles concurrent existence of PRD files for multiple branches without interference"
description: "Add a discovery layer that scans the .rex/ directory for all prd_*.json files, parses their branch segments to match against the current branch, and either returns the existing PRD file path or creates a new file following the naming convention. This becomes the single entry point for resolving which PRD file to use for the current branch context."
---

# Implement PRD file discovery and selection logic within the .rex directory

🔴 [completed]

## Summary

Add a discovery layer that scans the .rex/ directory for all prd_*.json files, parses their branch segments to match against the current branch, and either returns the existing PRD file path or creates a new file following the naming convention. This becomes the single entry point for resolving which PRD file to use for the current branch context.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** rex, storage
- **Level:** task
- **Started:** 2026-04-22T16:25:47.661Z
- **Completed:** 2026-04-22T16:30:27.341Z
- **Duration:** 4m
