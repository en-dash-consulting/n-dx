---
id: "1d772c01-64dc-4038-ae5d-6797fc23766f"
level: "task"
title: "Surface clear user-facing migration notification across CLI, MCP, and dashboard"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "ux"
  - "mcp"
  - "web"
source: "smart-add"
startedAt: "2026-04-30T20:18:47.106Z"
completedAt: "2026-04-30T20:36:06.643Z"
endedAt: "2026-04-30T20:36:06.643Z"
resolutionType: "code-change"
resolutionDetail: "Implemented complete migration notification system: CLI banners with ANSI colors respecting NO_COLOR/TTY, execution log entries, MCP warning field injection, and comprehensive unit tests (45 tests). Wired into 5 core CLI commands. Suppression under --quiet/--json flags with always-on logging pattern."
acceptanceCriteria:
  - "CLI banner is rendered using the existing ANSI color utility, respects NO_COLOR and TTY detection, and clearly states 'prd.json detected and migrated', backup path, and folder-tree path"
  - "Banner is suppressed when --quiet or --json is active, and replaced by a structured stderr/log entry"
  - "MCP tool responses include a one-time warning field on the first tool call that triggered the migration"
  - "Web dashboard shows a dismissible info banner sourced from the execution log entry until the user dismisses it"
  - "Regression tests assert banner emission, suppression under --quiet/--json, and MCP warning shape"
description: "When the helper performs a real migration (not a no-op), emit a prominent notification: a colored, multi-line CLI banner naming the backup file path, the new folder-tree location, and a one-line follow-up suggestion (e.g. inspect with rex status). For MCP responses, include a structured warning field on the tool result describing the migration. For the web server, log the migration to the execution log and surface a dismissible banner in the dashboard the next time it loads. Suppress the banner under --quiet/--json modes but still record a structured log entry."
---

# Surface clear user-facing migration notification across CLI, MCP, and dashboard

🟡 [completed]

## Summary

When the helper performs a real migration (not a no-op), emit a prominent notification: a colored, multi-line CLI banner naming the backup file path, the new folder-tree location, and a one-line follow-up suggestion (e.g. inspect with rex status). For MCP responses, include a structured warning field on the tool result describing the migration. For the web server, log the migration to the execution log and surface a dismissible banner in the dashboard the next time it loads. Suppress the banner under --quiet/--json modes but still record a structured log entry.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, ux, mcp, web
- **Level:** task
- **Started:** 2026-04-30T20:18:47.106Z
- **Completed:** 2026-04-30T20:36:06.643Z
- **Duration:** 17m
