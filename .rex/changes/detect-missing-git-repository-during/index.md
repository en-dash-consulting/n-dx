---
id: "5c71c175-ff37-4cf7-8a28-cba18a435184"
type: "change"
title: "Detect missing git repository during ndx init and surface explanatory prompt"
slug: "detect-missing-git-repository-during"
intent: "Before ndx init proceeds with sourcevision/rex/hench setup, check whether the target directory is inside a git repository. If not, print a clear message explaining that n-dx uses automatic git commits as part of its workflow and prompt the user to allow git initialization. If the user declines, continue init but emit a persistent warning that auto-commit features will be unavailable."
acceptanceCriteria:
  - "ndx init detects absence of a git repo (no .git ancestor) before tool-directory setup begins"
  - "A prompt is shown explaining that n-dx assumes a git project for automatic commits"
  - "User is offered a yes/no choice to run `git init` in the target directory"
  - "Declining the prompt still completes init but prints a warning about disabled auto-commit"
  - "Existing git repos skip this check entirely — no prompt is shown"
touches:
  - "ba9504c3-a0c7-4034-838c-2f5bf78ba904"
priority: "high"
tags:
  - "init"
  - "git"
  - "ux"
source: "smart-add"
---
