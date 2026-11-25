---
id: "b91027c2-36de-420b-976d-a02f1ee0331b"
type: "task"
title: "Stop sv workspace from taking a flag's value as its root"
slug: "stop-sv-workspace-from-taking-a-flag-s"
summary: "Make the workspace command always write to the folder the user meant, and refuse when the command line is ambiguous."
description: "packages/sourcevision/src/cli/index.ts calls `cmdWorkspace(targetArg || \".\", args.slice(1))`, where targetArg is the first non-flag argument. With space-separated flag values (`sv workspace --add <repoA> --add <repoB> <ws>`), `<repoA>` becomes the root and members are written into `<repoA>`'s config. Parse the workspace command's own flags first (packages/sourcevision/src/cli/commands/workspace.ts), so values of --add / --remove (both `--add=x` and `--add x`) are consumed, then take the remaining positional as the root. Add an explicit `--root=<dir>`. Refuse with an error naming both candidates when more than one positional remains, or when --root and a positional disagree. Update `sv workspace --help`."
acceptanceCriteria:
  - "sv workspace --add a --add b ws writes members into ws's config, not a's"
  - "sv workspace --add=a ws behaves the same"
  - "--root=<dir> sets the root explicitly"
  - "Two leftover positionals, or --root disagreeing with a positional, exit non-zero naming both and write nothing"
  - "The help text documents --root and the argument order"
priority: "medium"
tags:
  - "sourcevision"
  - "cli"
  - "workspace"
source: "ndx-capture"
---
