---
id: "f2bfa3e5-ff03-4c8d-b294-5850185bb5a9"
level: "task"
title: "Synchronize project documentation with current CLI command surface"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "cli"
  - "dx"
source: "smart-add"
startedAt: "2026-04-13T16:49:33.071Z"
completedAt: "2026-04-13T18:44:45.687Z"
acceptanceCriteria:
  - "Every command listed in CLAUDE.md Orchestration Commands and Direct Tool Access sections exists in the CLI and exits 0 with --help"
  - "All flag names and default values in documentation match current CLI behavior (verified by running --help against each)"
  - "No documentation section references commands or flags that have been removed or renamed"
  - "CODEX.md sections mirroring CLAUDE.md are updated in sync per the SYNC NOTICE at the top of CLAUDE.md"
  - "A CI assertion or documentation linting step is added (or an existing one is confirmed) that catches future doc/CLI divergence"
description: "Audit CLAUDE.md, CODEX.md, README files, and commands.md for command invocations, flag references, and workflow descriptions that no longer match the current CLI. Update all stale sections to reflect the actual command surface, remove references to removed commands, and add entries for commands added since the last documentation pass. Also verify that CLI --help output for each command matches the documented description."
---

# Synchronize project documentation with current CLI command surface

🟡 [completed]

## Summary

Audit CLAUDE.md, CODEX.md, README files, and commands.md for command invocations, flag references, and workflow descriptions that no longer match the current CLI. Update all stale sections to reflect the actual command surface, remove references to removed commands, and add entries for commands added since the last documentation pass. Also verify that CLI --help output for each command matches the documented description.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** docs, cli, dx
- **Level:** task
- **Started:** 2026-04-13T16:49:33.071Z
- **Completed:** 2026-04-13T18:44:45.687Z
- **Duration:** 1h 55m
