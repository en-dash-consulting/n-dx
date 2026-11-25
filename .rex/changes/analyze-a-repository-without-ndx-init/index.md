---
id: "dda019c0-eadb-447b-a175-d13cf3198851"
type: "change"
title: "Analyze a repository without ndx init, writing only to its own output folder, and discover many at once"
slug: "analyze-a-repository-without-ndx-init"
summary: "Analysing a code base today requires setting up n-dx in it first, and leaves small changes outside the analysis folder. Let analysis run on any checkout and touch only its own folder, then let one command find and analyse a whole folder of repositories."
intent: "Reported by downstream users who analyse many third-party repositories they do not own (checked against 0.10.5).\n\n- **Init required.** handleAnalyze (packages/core/cli.js) calls `requireInit(dir, [\"sourcevision\"])`, so `ndx analyze --fast .` in a repo where `ndx init` never ran stops with NDX_CLI_NOT_INITIALIZED. With an empty analysis folder made by hand it runs to a complete analysis. Running `ndx init` instead is not acceptable on a repo the operator does not own: it writes assistant files, config, .gitattributes and README.proposed.md.\n- **Writes outside its folder.** An analyze run on 0.10.4-era main appended `.ndx/sourcevision/.cache/` to the repo's .gitignore and wrote claude_commands.log at the root (from a `rex tree` call). `--fast` no longer writes the log (2f58d1c30); the .gitignore append has not been re-checked.\n- **Many repositories.** `sv workspace` aggregates members that are already analysed. A folder of fresh clones has to be analysed one by one first, so every batch user writes the same loop.\n\nRelated: sv workspace's root argument (the rex and CLI gaps change) and the open change that refuses workspace members outside the project root (2e3dfb4f)."
acceptanceCriteria:
  - "ndx analyze --fast . in a repository with no n-dx state completes, and git status afterwards shows only the analysis output folder"
  - "Running it twice does not change any file outside the output folder"
  - "sv workspace --discover <dir> finds the repositories under <dir>, analyses each, aggregates them and reports any it skipped with a reason"
touches:
  - "b9d3a37a-9227-4a10-87ba-de286cec7fac"
priority: "medium"
tags:
  - "core"
  - "sourcevision"
  - "batch-analysis"
source: "ndx-capture"
---
