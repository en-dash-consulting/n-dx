---
id: "3ca52f0b-a6e6-4453-bc38-3f768c0a386e"
type: "task"
title: "Add sv workspace --discover to find, analyse and aggregate the repositories under a folder"
slug: "add-sv-workspace-discover-to-find"
summary: "One command analyses a whole folder of repositories and combines the results, with a list of any it skipped and why."
description: "Add `sv workspace --discover <dir>` (packages/sourcevision/src/cli/commands/workspace.ts): walk <dir> for repository roots (a `.git` directory or file, and an SVN working copy's top `.svn`), not descending into a found root and never following a symlink out of <dir>. Analyse each found root with the static mode (`--fast`, no model or network call) where it has no current analysis, with bounded parallelism (`--jobs=<n>`, a conservative default), then register the found roots as members and aggregate as `sv workspace` does today. Write a skip report (in the command's output and as JSON with --json): per skipped repo, its path and reason (analysis failed, timed out, no supported files, outside <dir>). A per-repo timeout keeps one repo from stalling the batch. Reuse the containment helpers from the outside-member change (2e3dfb4f) if it has landed."
acceptanceCriteria:
  - "Over a folder with three fixture repos, one of which fails analysis, --discover analyses the other two, aggregates them and reports the third with its reason"
  - "A repo nested inside another found repo is not analysed separately"
  - "A symlink in <dir> pointing outside it is not followed"
  - "Repos with a current analysis are not re-analysed"
  - "--jobs bounds concurrent analyses and --json prints the found and skipped lists"
  - "No model or network call is made"
priority: "low"
tags:
  - "sourcevision"
  - "workspace"
  - "batch-analysis"
source: "ndx-capture"
blockedBy:
  - "ac9a2ba2-c37a-48cb-b7ef-9a968c7392b1"
  - "b91027c2-36de-420b-976d-a02f1ee0331b"
---
