---
id: "74047536-342a-4358-b2ec-33e783786b2a"
level: "task"
title: "Add regression coverage and help text for version flags"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "testing"
  - "docs"
source: "smart-add"
startedAt: "2026-04-06T19:19:59.169Z"
completedAt: "2026-04-06T19:23:14.178Z"
acceptanceCriteria:
  - "Automated tests cover both `-v` and `--version` at the top-level CLI entrypoint"
  - "Tests verify the command exits successfully and does not route into unrelated subcommand execution"
  - "CLI help output mentions `-v, --version` as supported top-level flags"
  - "The documented behavior matches the actual output format used by the CLI"
description: "Update automated CLI tests and user-facing help output so the new version flags remain discoverable and do not regress when command parsing changes in the future."
---

# Add regression coverage and help text for version flags

🟡 [completed]

## Summary

Update automated CLI tests and user-facing help output so the new version flags remain discoverable and do not regress when command parsing changes in the future.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, testing, docs
- **Level:** task
- **Started:** 2026-04-06T19:19:59.169Z
- **Completed:** 2026-04-06T19:23:14.178Z
- **Duration:** 3m
