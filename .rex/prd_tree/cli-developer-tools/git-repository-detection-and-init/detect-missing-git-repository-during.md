---
id: "5c71c175-ff37-4cf7-8a28-cba18a435184"
level: "task"
title: "Detect missing git repository during ndx init and surface explanatory prompt"
status: "completed"
priority: "high"
tags:
  - "init"
  - "git"
  - "ux"
source: "smart-add"
startedAt: "2026-06-02T13:16:18.952Z"
completedAt: "2026-06-02T13:25:19.650Z"
endedAt: "2026-06-02T13:25:19.650Z"
resolutionType: "code-change"
resolutionDetail: "Added packages/core/git-preflight.js (isInsideGitRepo, runGitPreflight, runGitInit, formatGitWarningLines). Wired into handleInit before sub-tool setup; TTY paths show the explanation + y/n prompt and run `git init` on consent. Non-TTY/quiet runs skip the prompt and surface a persistent yellow warning in the recap (Ink + static paths). Existing git repos short-circuit silently. Added unit + e2e tests; bumped architecture-policy ALLOWED for child_process; added file to @n-dx/core package.json `files`."
acceptanceCriteria:
  - "ndx init detects absence of a git repo (no .git ancestor) before tool-directory setup begins"
  - "A prompt is shown explaining that n-dx assumes a git project for automatic commits"
  - "User is offered a yes/no choice to run `git init` in the target directory"
  - "Declining the prompt still completes init but prints a warning about disabled auto-commit"
  - "Existing git repos skip this check entirely — no prompt is shown"
description: "Before ndx init proceeds with sourcevision/rex/hench setup, check whether the target directory is inside a git repository. If not, print a clear message explaining that n-dx uses automatic git commits as part of its workflow and prompt the user to allow git initialization. If the user declines, continue init but emit a persistent warning that auto-commit features will be unavailable."
---
