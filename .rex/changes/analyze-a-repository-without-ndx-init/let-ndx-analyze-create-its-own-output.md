---
id: "ac9a2ba2-c37a-48cb-b7ef-9a968c7392b1"
type: "task"
title: "Let ndx analyze create its own output folder and write nothing outside it"
slug: "let-ndx-analyze-create-its-own-output"
summary: "Analysis works on any checkout without setup, and leaves the rest of the repository untouched."
description: "In handleAnalyze (packages/core/cli.js), replace `requireInit(dir, [\"sourcevision\"])` with creating the sourcevision output folder where resolveLayout puts it (`.ndx/sourcevision` when `.ndx/` exists or neither layout does, else `.sourcevision`), so analysis runs in a repo `ndx init` never touched. Other commands keep their requireInit. Then make a run write nothing outside that folder: find and remove (or move inside the folder) any .gitignore append (keep the cache ignored with a .gitignore inside the output folder instead of editing the repo's), any command log at the repo root, and any other root-level write in the analyze path, including preflight (withPreflight) and the run summary's reads. The run summary should not call the project's setup incomplete for an analyze-only repo. Verify with a real run on a fixture repo, not only unit tests."
acceptanceCriteria:
  - "ndx analyze --fast . in a fresh git repo with no .ndx or .sourcevision completes with exit 0"
  - "Afterwards git status --porcelain --untracked-files=all lists only paths inside the output folder"
  - "The repo's .gitignore is byte-identical before and after"
  - "The default (model) mode also writes nothing outside the folder apart from what the operator's own vendor CLI does"
  - "ndx status, ndx work and the other requireInit commands still refuse an uninitialised repo as before"
  - "An integration test covers the fresh-repo run"
priority: "medium"
tags:
  - "core"
  - "sourcevision"
  - "batch-analysis"
source: "ndx-capture"
---
