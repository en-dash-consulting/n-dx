---
id: "3f1a60ca-0821-4e6d-bb52-1de066675a6b"
level: "feature"
title: "Automatic prd.json Detection, Backup, and Migration on PRD-Touching Commands"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T20:36:07.865Z"
completedAt: "2026-04-30T20:36:07.865Z"
endedAt: "2026-04-30T20:36:07.865Z"
acceptanceCriteria: []
description: "Any CLI command, MCP tool, or web server entry point that reads or writes the PRD must detect a legacy prd.json file at startup, back it up to a timestamped copy, run the existing migration to the folder-tree format, and emit a clearly visible notification to the user about what happened. Today the legacy migration only triggers in specific paths (e.g. rex migrate-to-folder-tree); commands that touch the PRD directly can silently bypass this, leaving stale prd.json files and confusing state. This feature guarantees a one-shot, well-announced, recoverable migration the first time any PRD-aware command runs in a project that still contains prd.json."
---

# Automatic prd.json Detection, Backup, and Migration on PRD-Touching Commands

 [completed]

## Summary

Any CLI command, MCP tool, or web server entry point that reads or writes the PRD must detect a legacy prd.json file at startup, back it up to a timestamped copy, run the existing migration to the folder-tree format, and emit a clearly visible notification to the user about what happened. Today the legacy migration only triggers in specific paths (e.g. rex migrate-to-folder-tree); commands that touch the PRD directly can silently bypass this, leaving stale prd.json files and confusing state. This feature guarantees a one-shot, well-announced, recoverable migration the first time any PRD-aware command runs in a project that still contains prd.json.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Implement shared legacy-PRD detection, backup, and migration helper | task | completed | 2026-04-30 |
| Surface clear user-facing migration notification across CLI, MCP, and dashboard | task | completed | 2026-04-30 |
| Wire legacy-PRD migration check into all PRD-touching command entry points | task | completed | 2026-04-30 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-30T20:36:07.865Z
- **Completed:** 2026-04-30T20:36:07.865Z
- **Duration:** < 1m
