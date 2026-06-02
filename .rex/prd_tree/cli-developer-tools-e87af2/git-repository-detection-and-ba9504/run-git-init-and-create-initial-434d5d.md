---
id: "434d5dfb-d98c-4be5-b3fa-8f2c02547628"
level: "task"
title: "Run git init and create initial n-dx commit when user consents during ndx init"
status: "completed"
priority: "high"
tags:
  - "init"
  - "git"
  - "commit"
source: "smart-add"
startedAt: "2026-06-02T13:25:49.256Z"
completedAt: "2026-06-02T13:39:54.354Z"
endedAt: "2026-06-02T13:39:54.354Z"
resolutionType: "code-change"
resolutionDetail: "Added commitInitBaseline + formatGitInitCommitLines to packages/core/git-preflight.js; wired into cli.js (static path) and cli-ink.js (TUI Recap). When gitResult.status === \"initialized\" (user just consented to git init), the helper stages .sourcevision/.rex/.hench/.n-dx.json plus .gitignore and any assistant surfaces (CLAUDE.md, AGENTS.md, .claude/, .codex/, README.*), then commits with message \"chore: n-dx init\". Failures (add/commit) return a status the formatter renders as a clear warning; init continues. Unit tests cover all four result statuses and a real git_init+commit happy path. E2E tests pin the negative cases (pre-existing repo, non-interactive run). 19 unit + 3 e2e tests green; full root-level suite 1757/1758 pass (1 skipped). hench loop-timer-expiry-stall is a pre-existing flake (passes in isolation)."
acceptanceCriteria:
  - "`git init` is executed in the target directory after user consent"
  - "All n-dx-generated files (.sourcevision/, .rex/, .hench/, .n-dx.json) are staged and committed"
  - "Commit message identifies the commit as the n-dx init baseline (e.g. 'chore: n-dx init')"
  - "Init summary output confirms the git repository was created and the initial commit was made"
  - "If `git init` or the commit fails, the error is surfaced clearly and init does not silently continue"
description: "When the user agrees to git initialization in the preflight prompt, run `git init`, stage the newly created n-dx tool directories (.sourcevision, .rex, .hench), and create an initial commit with a standard message indicating the n-dx init baseline. The commit should be created after all tool directories are written so the snapshot is complete."
---
