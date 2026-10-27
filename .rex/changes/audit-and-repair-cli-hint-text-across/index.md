---
id: "e2ddb064-3972-475d-8162-91d33caa5ec3"
type: "change"
title: "Audit and repair CLI hint text across all commands"
slug: "audit-and-repair-cli-hint-text-across"
intent: "Walk every CLI command in all packages (ndx/rex/hench/sourcevision) and verify that each hint, suggestion, and recommendation references a command, flag, or workflow that currently exists and behaves as described. Fix hint text that references removed flags, renamed commands, outdated invocation patterns, or deprecated workflows. Covers both inline help strings and the interactive hint/suggestion output paths."
acceptanceCriteria:
  - "All hint strings in ndx, rex, hench, and sourcevision reference commands and flags that exist in the current CLI surface"
  - "No hint references a removed or renamed flag (e.g., obsolete --mode values, deprecated subcommands)"
  - "Typo-correction suggestions map to valid existing command names"
  - "Related-command hints shown after errors resolve to commands that succeed when run"
  - "A manual audit checklist is committed documenting each command's hint coverage status"
touches:
  - "6ba40421-b660-40fb-9c7d-70651bb863e1"
priority: "high"
tags:
  - "cli"
  - "dx"
  - "hints"
source: "smart-add"
---
