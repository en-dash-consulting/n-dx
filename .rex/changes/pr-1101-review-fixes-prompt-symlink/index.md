---
id: "cd58e1fb-2ef3-4e10-afdb-65d656cde237"
type: "change"
title: "PR #1101 review fixes: prompt symlink escape, run-queue status and locking, Running now's worktree link, release build ref"
slug: "pr-1101-review-fixes-prompt-symlink"
summary: "Fixes the five problems a reviewer found in the Plan and Work redesign: the agent prompt file could be written outside the project through a broken link, the run queue could drop or lose tasks, a running task from another worktree opened the wrong page, and release binaries could be built from the wrong commit."
intent: "From the review of PR #1101 (reviewer comments 4672392623, 4672392634, 4672392642, 4672392647, 4672392651) and four CodeQL alerts on test files (code-scanning 138-141)."
acceptanceCriteria:
  - "Each reviewer finding is fixed with a regression test and answered on the PR"
  - "The CodeQL alerts on the PR are fixed or answered"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
discoveredFrom: {"item":"9e87cb29-be37-4d69-b4b5-5f771e520424"}
tags:
  - "pr-1101"
  - "review"
source: "pr-review"
---
