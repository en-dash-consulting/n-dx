---
id: "0150c623-cefa-46e5-a3a0-51aad861311b"
level: "task"
title: "Rename single-command and sc CLI entrypoints to pair-programming and bicker"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "rename"
  - "orchestration"
source: "smart-add"
startedAt: "2026-04-16T16:09:55.174Z"
completedAt: "2026-04-16T16:19:55.372Z"
acceptanceCriteria:
  - "ndx pair-programming and ndx bicker both route to the same handler that single-command/sc previously wired"
  - "ndx single-command and ndx sc print a deprecation/rename error message pointing to the new names and exit non-zero"
  - "ndx --help and ndx pair-programming --help display the new command name and bicker alias"
  - "All test files referencing single-command or sc are updated to use pair-programming and bicker"
  - "No references to 'single-command' or ' sc ' as a command name remain in production code or docs"
description: "The recently added ndx single-command (alias sc) entrypoints in the core orchestrator need to be renamed to ndx pair-programming (full name) and ndx bicker (short alias) before the feature ships. This covers the CLI registration in cli.js, all help text, any internal constant strings, and any test references. The old names should emit a clear 'renamed to pair-programming / bicker' error to guide users who cached the old names."
---

# Rename single-command and sc CLI entrypoints to pair-programming and bicker

🟠 [completed]

## Summary

The recently added ndx single-command (alias sc) entrypoints in the core orchestrator need to be renamed to ndx pair-programming (full name) and ndx bicker (short alias) before the feature ships. This covers the CLI registration in cli.js, all help text, any internal constant strings, and any test references. The old names should emit a clear 'renamed to pair-programming / bicker' error to guide users who cached the old names.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** cli, rename, orchestration
- **Level:** task
- **Started:** 2026-04-16T16:09:55.174Z
- **Completed:** 2026-04-16T16:19:55.372Z
- **Duration:** 10m
