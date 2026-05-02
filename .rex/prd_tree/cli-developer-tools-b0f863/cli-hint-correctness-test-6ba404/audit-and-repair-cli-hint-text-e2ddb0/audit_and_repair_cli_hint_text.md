---
id: "e2ddb064-3972-475d-8162-91d33caa5ec3"
level: "task"
title: "Audit and repair CLI hint text across all commands"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "dx"
  - "hints"
source: "smart-add"
startedAt: "2026-04-13T16:35:01.665Z"
completedAt: "2026-04-13T16:45:52.704Z"
acceptanceCriteria:
  - "All hint strings in ndx, rex, hench, and sourcevision reference commands and flags that exist in the current CLI surface"
  - "No hint references a removed or renamed flag (e.g., obsolete --mode values, deprecated subcommands)"
  - "Typo-correction suggestions map to valid existing command names"
  - "Related-command hints shown after errors resolve to commands that succeed when run"
  - "A manual audit checklist is committed documenting each command's hint coverage status"
description: "Walk every CLI command in all packages (ndx/rex/hench/sourcevision) and verify that each hint, suggestion, and recommendation references a command, flag, or workflow that currently exists and behaves as described. Fix hint text that references removed flags, renamed commands, outdated invocation patterns, or deprecated workflows. Covers both inline help strings and the interactive hint/suggestion output paths."
---
